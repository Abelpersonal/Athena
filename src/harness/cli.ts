#!/usr/bin/env node
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { webSearch, closeWebSearch } from "../mcp/webSearch.js";
import { run } from "../orchestrator/index.js";
import { getLogPath } from "../orchestrator/logging.js";
import { runResearchPipeline, ResearchPipelineError } from "../research/pipeline.js";
import type { CourseJson } from "../research/types.js";
import { buildCourse, CourseBuilderError } from "../courseBuilder/index.js";
import { aggregateMaterials } from "../materialAggregator/index.js";
import { getDb, resetDbCache } from "../db/client.js";
import { slugify } from "../shared/ids.js";
import {
  createMockOrchestratorRun,
  createMockSearchProvider,
  mockFetchAndClean,
  createMockMaterialFetchAndClean,
  createMockBackfillSubtopic,
} from "./mocks.js";

/**
 * Debugging CLI across Phases 1-6. Modes:
 *
 *   npm run harness -- "<topic>"                    Phase 1 demo: search -> summarize_text
 *   npm run harness -- research "<topic>"            Phase 2 pipeline, real APIs, writes output/<slug>.json
 *   npm run harness -- research --dry-run "<topic>"  Phase 2 pipeline with mocked LLM/search/fetch (no API cost)
 *   npm run harness -- build "<topic>"               Phase 3: research -> Course Builder -> Material Aggregator, real APIs + real DB
 *   npm run harness -- build --dry-run "<topic>"      same, fully mocked (no API cost, writes to data/teacher.dry-run.db)
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === "research") {
    await runResearchCommand(args.slice(1));
    return;
  }
  if (args[0] === "build") {
    await runBuildCommand(args.slice(1));
    return;
  }

  await runPhase1DemoCommand(args);
}

async function runPhase1DemoCommand(args: string[]): Promise<void> {
  const topic = args.join(" ").trim();
  if (!topic) {
    console.error('Usage: npm run harness -- "<topic>"');
    process.exitCode = 1;
    return;
  }

  console.log(`\n[harness] Searching the web for: "${topic}"`);
  const results = await webSearch([topic]);
  console.log(`[harness] Got ${results.length} search result(s).`);
  if (results.length === 0) {
    console.warn(
      "[harness] No search results — check TAVILY_API_KEY and network access. Continuing with an empty snippet set."
    );
  }

  const combinedText = results
    .map((r, i) => `[${i + 1}] ${r.title} (${r.url})\n${r.snippet}`)
    .join("\n\n");

  console.log("\n[harness] Summarizing search results via the Orchestrator...");
  const result = await run(
    "summarize_text",
    { text: combinedText || `No search results were found for "${topic}".`, maxWords: 120 },
    "harness-cli"
  );

  console.log("\n[harness] Structured result:");
  console.log(JSON.stringify(result, null, 2));
  console.log(`\n[harness] JSONL log written to: ${getLogPath()}`);
}

async function runResearchCommand(args: string[]): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const topic = args.filter((a) => a !== "--dry-run").join(" ").trim();

  if (!topic) {
    console.error('Usage: npm run harness -- research [--dry-run] "<topic>"');
    process.exitCode = 1;
    return;
  }

  console.log(`\n[research-harness] Topic: "${topic}"${dryRun ? " (--dry-run: mocked, no real API calls)" : ""}`);

  const startedAt = Date.now();
  let course: CourseJson;
  try {
    course = await runResearchPipeline(topic, {
      onProgress: (message) => console.log(`[research-harness] ${message}`),
      ...(dryRun
        ? {
            orchestratorRun: createMockOrchestratorRun(),
            searchProvider: createMockSearchProvider(),
            fetchAndClean: mockFetchAndClean,
          }
        : {}),
    });
  } catch (error) {
    if (error instanceof ResearchPipelineError) {
      console.error(`\n[research-harness] Pipeline failed: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  const outPath = await writeCourseJson(course, dryRun);
  printSummary(course, elapsedSeconds, outPath, dryRun);
}

async function runBuildCommand(args: string[]): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const topic = args.filter((a) => a !== "--dry-run").join(" ").trim();

  if (!topic) {
    console.error('Usage: npm run harness -- build [--dry-run] "<topic>"');
    process.exitCode = 1;
    return;
  }

  console.log(`\n[build-harness] Topic: "${topic}"${dryRun ? " (--dry-run: mocked, no real API calls, isolated DB)" : ""}`);

  // Dry runs get their own DB file so mocked/fake course data never lands in the real,
  // inspectable data/teacher.db — matches research --dry-run writing to a .dry-run.json.
  resetDbCache();
  const db = await getDb(dryRun ? path.join(process.cwd(), "data", "teacher.dry-run.db") : undefined);

  const mockOrchestratorRun = dryRun ? createMockOrchestratorRun() : undefined;
  const onProgress = (message: string) => console.log(`[build-harness] ${message}`);

  const startedAt = Date.now();
  let course: CourseJson;
  try {
    course = await runResearchPipeline(topic, {
      onProgress,
      ...(dryRun
        ? { orchestratorRun: mockOrchestratorRun, searchProvider: createMockSearchProvider(), fetchAndClean: mockFetchAndClean }
        : {}),
    });
  } catch (error) {
    if (error instanceof ResearchPipelineError) {
      console.error(`\n[build-harness] Research pipeline failed: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  let built: Awaited<ReturnType<typeof buildCourse>>;
  try {
    built = await buildCourse(course, {
      onProgress,
      db,
      ...(dryRun ? { orchestratorRun: mockOrchestratorRun } : {}),
    });
  } catch (error) {
    if (error instanceof CourseBuilderError) {
      console.error(`\n[build-harness] Course Builder failed: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const aggregated = await aggregateMaterials(built.courseId, course, built.subtopicLessonMap, {
    onProgress,
    db,
    ...(dryRun
      ? { fetchAndClean: createMockMaterialFetchAndClean(), backfillSubtopic: createMockBackfillSubtopic() }
      : {}),
  });

  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n[build-harness] Done in ${elapsedSeconds}s${dryRun ? " (dry run)" : ""}.`);
  console.log(`[build-harness] course_id: ${built.courseId}`);
  console.log(`[build-harness] ${built.moduleCount} module(s), ${built.lessonCount} lesson(s), ${aggregated.sourceCount} persisted source(s).`);
  console.log(
    `[build-harness] backfill triggered for ${aggregated.backfillTriggeredCount} lesson(s); ${aggregated.belowThresholdLessonCount} still below threshold after backfill.`
  );
  console.log(`[build-harness] Inspect with: npm run inspect -- ${built.courseId}${dryRun ? "  (--dry-run db: data/teacher.dry-run.db)" : ""}`);
  if (!dryRun) {
    console.log(`[build-harness] JSONL log written to: ${getLogPath()}`);
  }
}

async function writeCourseJson(course: CourseJson, dryRun: boolean): Promise<string> {
  const slug = slugify(course.topic) || "topic";
  const outDir = path.join(process.cwd(), "output");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${slug}${dryRun ? ".dry-run" : ""}.json`);
  await writeFile(outPath, JSON.stringify(course, null, 2), "utf-8");
  return outPath;
}

function printSummary(course: CourseJson, elapsedSeconds: string, outPath: string, dryRun: boolean): void {
  console.log(`\n[research-harness] Done in ${elapsedSeconds}s${dryRun ? " (dry run)" : ""}.`);
  console.log(`[research-harness] Wrote course JSON to: ${outPath}`);
  console.log(`[research-harness] ${course.subtopics.length} subtopic(s), ${course.prerequisites.length} prerequisite(s).`);

  for (const subtopic of course.subtopics) {
    const retriedAttempts = subtopic.auditPasses.length;
    const neededRetry = retriedAttempts > 1;
    const lastPass = subtopic.auditPasses[subtopic.auditPasses.length - 1];
    const status = subtopic.auditStatus === "passed" ? "PASSED" : "SHALLOW (shipped anyway)";
    console.log(
      `  - "${subtopic.title}" — audit: ${status} after ${retriedAttempts} attempt(s)${
        neededRetry ? " [needed retry]" : ""
      }, volatility: ${subtopic.volatility.tier} (${subtopic.volatility.justification})`
    );
    if (neededRetry) {
      const firstAudit = subtopic.auditPasses[0]!;
      const failedCriteria = Object.entries(firstAudit.criteria)
        .filter(([, c]) => !c.pass)
        .map(([name]) => name)
        .join(", ");
      console.log(`    first-pass failing criteria: ${failedCriteria}`);
    }
    if (lastPass && !lastPass.overallPass) {
      const stillFailing = Object.entries(lastPass.criteria)
        .filter(([, c]) => !c.pass)
        .map(([name]) => name)
        .join(", ");
      console.log(`    still failing after retries: ${stillFailing}`);
    }
  }

  if (!dryRun) {
    console.log(`\n[research-harness] JSONL log written to: ${getLogPath()}`);
  }
}

main()
  .catch((error) => {
    console.error("[harness] Failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeWebSearch();
  });
