#!/usr/bin/env node
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
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
import {
  generateQuizQuestions,
  scoreAndRecordQuiz,
  ALL_QUIZ_TIERS,
  QuizEngineError,
  type QuizTier,
  type QuizQuestion,
  type QuizAnswer,
} from "../quizEngine/index.js";
import {
  preparePracticeSession,
  runDialogueTurn,
  critiquePracticeAttempt,
  generateReflectionPromptText,
  recordPracticeAttempt,
  PracticeEngineError,
  type PracticeSession,
  type DialogueHistoryEntry,
} from "../practiceEngine/index.js";
import {
  classifyInput,
  decomposeAndPersistPath,
  runOverlapDetectionForPath,
  loadPathRoadmap,
  isTopicGeneratable,
  generateTopicCourse,
  PathPlannerError,
  type PathTopicRoadmapEntry,
} from "../pathPlanner/index.js";

/**
 * Debugging CLI across Phases 1-6. Modes:
 *
 *   npm run harness -- "<topic>"                    Phase 1 demo: search -> summarize_text
 *   npm run harness -- research "<topic>"            Phase 2 pipeline, real APIs, writes output/<slug>.json
 *   npm run harness -- research --dry-run "<topic>"  Phase 2 pipeline with mocked LLM/search/fetch (no API cost)
 *   npm run harness -- build "<topic>"               Phase 3: research -> Course Builder -> Material Aggregator, real APIs + real DB
 *   npm run harness -- build --dry-run "<topic>"      same, fully mocked (no API cost, writes to data/teacher.dry-run.db)
 *   npm run harness -- quiz <lesson_id> [tier]        Phase 4: Quiz Engine, real APIs — CLI prompts, prints score + updated mastery state
 *   npm run harness -- practice <module_id>           Phase 4: Practice Engine, real APIs — CLI (multi-turn for simulation/debate), prints critique + reflection + updated experience score
 *   npm run harness -- goal "<input>"                 Phase 5: Goal Planner, real APIs — classifies topic-vs-goal (CLI-confirmed,
 *                                                      overridable), a single-topic classification runs the existing build pipeline
 *                                                      unchanged, a goal classification decomposes into a cross-domain roadmap, runs
 *                                                      overlap detection, prints the annotated roadmap, then loops letting the user
 *                                                      pick a generatable pending/delta_needed topic to generate next
 *
 * quiz/practice have no --dry-run mode (unlike research/build) — they operate on
 * lesson/module content that must already be persisted (from a prior research/build
 * run), and their own LLM calls are cheap enough per-invocation that mocking them
 * wasn't judged worth the added harness complexity. Their engine functions are still
 * fully dependency-injectable (orchestratorRun/db) for unit tests — see tests/quizEngine.test.ts
 * and tests/practiceEngine.test.ts.
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
  if (args[0] === "quiz") {
    await runQuizCommand(args.slice(1));
    return;
  }
  if (args[0] === "practice") {
    await runPracticeCommand(args.slice(1));
    return;
  }
  if (args[0] === "goal") {
    await runGoalCommand(args.slice(1));
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

// ---------------------------------------------------------------------------
// Phase 4: quiz [lesson_id] [tier]
// ---------------------------------------------------------------------------

async function collectMultilineInput(
  rl: ReturnType<typeof createInterface>,
  instructions: string
): Promise<string> {
  console.log(instructions);
  const lines: string[] = [];
  for (;;) {
    const line = await rl.question("");
    if (line.trim() === "/done") break;
    lines.push(line);
  }
  return lines.join("\n").trim();
}

async function runQuizCommand(args: string[]): Promise<void> {
  const [lessonId, tierArg] = args;
  if (!lessonId) {
    console.error("Usage: npm run harness -- quiz <lesson_id> [recall|application|transfer]");
    process.exitCode = 1;
    return;
  }
  if (tierArg && !ALL_QUIZ_TIERS.includes(tierArg as QuizTier)) {
    console.error(`Invalid tier "${tierArg}". Must be one of: ${ALL_QUIZ_TIERS.join(", ")}.`);
    process.exitCode = 1;
    return;
  }
  const tiers: QuizTier[] = tierArg ? [tierArg as QuizTier] : ALL_QUIZ_TIERS;

  const db = await getDb();
  const onProgress = (message: string) => console.log(`[quiz-harness] ${message}`);

  let questions: QuizQuestion[];
  try {
    questions = await generateQuizQuestions(lessonId, tiers, { db, onProgress });
  } catch (error) {
    if (error instanceof QuizEngineError) {
      console.error(`\n[quiz-harness] ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answers: QuizAnswer[] = [];
  try {
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]!;
      console.log(`\n[${i + 1}/${questions.length}] (${q.tier}) ${q.prompt}`);
      if (q.type === "multiple_choice") {
        q.options.forEach((opt, idx) => console.log(`  ${idx + 1}. ${opt}`));
        let selectedIndex = Number.NaN;
        while (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= q.options.length) {
          const raw = await rl.question(`Your answer (1-${q.options.length}): `);
          selectedIndex = Number(raw.trim()) - 1;
        }
        answers.push({ questionId: q.id, answer: selectedIndex });
      } else {
        const raw = await rl.question("Your answer: ");
        answers.push({ questionId: q.id, answer: raw.trim() });
      }
    }
  } finally {
    rl.close();
  }

  const result = await scoreAndRecordQuiz(lessonId, questions, answers, { db, onProgress });

  console.log(`\n[quiz-harness] Results for lesson ${lessonId}:`);
  for (const [tier, score] of Object.entries(result.tierScores)) {
    console.log(`  ${tier}: ${(score as number).toFixed(2)}`);
  }
  console.log(`  overall: ${result.overallScore.toFixed(2)}`);
  console.log(
    `\n[quiz-harness] Updated MasteryState — concept_node_id: ${result.masteryState.conceptNodeId}, ` +
      `knowledge_score: ${result.masteryState.knowledgeScore?.toFixed(2)}, ` +
      `experience_score: ${result.masteryState.experienceScore ?? "(untouched)"}, ` +
      `last_updated: ${result.masteryState.lastUpdated}`
  );
  if (result.weakConceptNodes.length > 0) {
    console.log(`[quiz-harness] Weak concept node(s) flagged: ${result.weakConceptNodes.join(", ")}`);
  }
}

// ---------------------------------------------------------------------------
// Phase 4: practice [module_id]
// ---------------------------------------------------------------------------

function describePracticeContent(session: PracticeSession): void {
  console.log(`\n[practice-harness] topic_type: ${session.topicType} (${session.topicTypeJustification})`);
  console.log(`[practice-harness] format: ${session.format} (${session.formatJustification})`);
  console.log(`[practice-harness] attempt: ${session.attemptNumber}, difficulty: ${session.difficulty}`);
  if (session.priorMistakes) {
    console.log(`[practice-harness] targeting recurring mistake(s) from the last attempt: ${session.priorMistakes}`);
  }
  if (session.format === "project" && session.project) {
    console.log(`\nTask: ${session.project.task}`);
    console.log(`\nStarting material:\n${session.project.datasetOrPrompt}`);
    console.log(`\nExpected deliverable: ${session.project.deliverableExpectations}`);
  } else if (session.format === "simulation" && session.simulation) {
    console.log(`\nScenario: ${session.simulation.scenario}`);
    console.log(`Counterpart: ${session.simulation.personaName} (${session.simulation.personaRole})`);
  } else if (session.format === "debate" && session.debate) {
    console.log(`\nContested claim: ${session.debate.claim}`);
    console.log(`Your assigned position: ${session.debate.userPosition}`);
  }
}

async function runDialogueLoop(
  rl: ReturnType<typeof createInterface>,
  session: PracticeSession,
  openingLine: string,
  onProgress: (message: string) => void
): Promise<string> {
  const MAX_USER_TURNS = 8;
  const history: DialogueHistoryEntry[] = [{ speaker: "ai", text: openingLine }];
  console.log(`\n${session.format === "simulation" ? session.simulation!.personaName : "Opponent"}: ${openingLine}`);
  console.log('(Type your reply each turn. Type "/end" on its own line to finish the dialogue.)');

  for (let turn = 0; turn < MAX_USER_TURNS; turn++) {
    const userInput = await rl.question("\nYou: ");
    if (userInput.trim() === "/end") break;

    const priorHistory = [...history];
    const reply = await runDialogueTurn(session, priorHistory, userInput, { onProgress });
    history.push({ speaker: "user", text: userInput }, { speaker: "ai", text: reply });
    console.log(`\n${session.format === "simulation" ? session.simulation!.personaName : "Opponent"}: ${reply}`);

    if (turn === MAX_USER_TURNS - 1) {
      console.log(`\n(Reached the ${MAX_USER_TURNS}-turn safety cap — ending the dialogue here.)`);
    }
  }

  return history.map((h) => `${h.speaker === "user" ? "Learner" : "Counterpart"}: ${h.text}`).join("\n");
}

async function runPracticeCommand(args: string[]): Promise<void> {
  const moduleId = args[0];
  if (!moduleId) {
    console.error("Usage: npm run harness -- practice <module_id>");
    process.exitCode = 1;
    return;
  }

  const db = await getDb();
  const onProgress = (message: string) => console.log(`[practice-harness] ${message}`);

  let session: PracticeSession;
  try {
    session = await preparePracticeSession(moduleId, { db, onProgress });
  } catch (error) {
    if (error instanceof PracticeEngineError) {
      console.error(`\n[practice-harness] ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  describePracticeContent(session);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let userOutput: string;
  try {
    if (session.format === "project") {
      userOutput = await collectMultilineInput(
        rl,
        '\nType your submission. End with a line containing only "/done".'
      );
    } else {
      const openingLine =
        session.format === "simulation" ? session.simulation!.openingLine : session.debate!.openingArgument;
      userOutput = await runDialogueLoop(rl, session, openingLine, onProgress);
    }

    console.log("\n[practice-harness] Generating critique...");
    const { critique, performanceScore } = await critiquePracticeAttempt(session, userOutput, { onProgress });
    console.log(`\nCritique:\n${critique}`);
    console.log(`\nPerformance score: ${performanceScore.toFixed(2)}`);

    const reflectionPrompt = await generateReflectionPromptText(session, critique, { onProgress });
    const reflectionNotes = await collectMultilineInput(
      rl,
      `\nReflection prompt: ${reflectionPrompt}\n(Type your reflection. End with a line containing only "/done".)`
    );

    const recorded = await recordPracticeAttempt(session, critique, reflectionNotes, performanceScore, {
      db,
      onProgress,
    });

    console.log(
      `\n[practice-harness] Recorded PracticeAttempt ${recorded.attemptId} (attempt ${recorded.attemptNumber}, type: ${session.format}).`
    );
    console.log(
      `[practice-harness] Updated MasteryState.experience_score = ${performanceScore.toFixed(2)} for lesson(s): ${recorded.updatedLessonIds.join(", ")}`
    );
    console.log(
      recorded.willEscalateNextAttempt
        ? "[practice-harness] Next attempt on this module will be generated at a harder difficulty, incorporating this attempt's critique."
        : "[practice-harness] Escalation cap reached — future attempts on this module stay at novel_unguided difficulty."
    );
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// Phase 5: goal "<input>"
// ---------------------------------------------------------------------------

function printRoadmap(roadmap: PathTopicRoadmapEntry[]): void {
  const masteredOrLinked = roadmap.filter((t) => t.status === "linked_existing" || t.status === "mastered").length;
  console.log(
    `\n[goal-harness] Roadmap (${roadmap.length} topic(s) total, ${masteredOrLinked} already mastered/linked):`
  );
  let lastDomain: string | null = null;
  let lastTier = -1;
  for (const t of roadmap) {
    if (t.domainName !== lastDomain) {
      console.log(`\n  Domain: ${t.domainName}`);
      lastDomain = t.domainName;
    }
    if (t.order !== lastTier) {
      console.log(`    -- tier ${t.order} (parallel group: ${t.parallelGroup}) --`);
      lastTier = t.order;
    }
    console.log(`    [${t.status}] ${t.topicName}${t.courseId ? ` (course: ${t.courseId})` : ""}`);
  }
}

async function runGoalCommand(args: string[]): Promise<void> {
  const input = args.join(" ").trim();
  if (!input) {
    console.error('Usage: npm run harness -- goal "<input>"');
    process.exitCode = 1;
    return;
  }

  const db = await getDb();
  const onProgress = (message: string) => console.log(`[goal-harness] ${message}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log(`\n[goal-harness] Classifying: "${input}"...`);
    const classification = await classifyInput(input);
    console.log(`[goal-harness] Model classification: ${classification.classification.toUpperCase()}`);
    console.log(`[goal-harness] Reasoning: ${classification.reasoning}`);

    const suggestedDefault = classification.classification;
    const answer = (
      await rl.question(
        `\nThis looks like a ${classification.classification === "goal" ? "big GOAL" : "single TOPIC"} — build a full ` +
          `multi-course path, or just one course on the core idea? [path/topic] (default: ${
            suggestedDefault === "goal" ? "path" : "topic"
          }): `
      )
    )
      .trim()
      .toLowerCase();

    const wantsPath = answer === "path" || answer === "goal" || (answer === "" && suggestedDefault === "goal");
    if (!wantsPath) {
      console.log(
        `\n[goal-harness] Proceeding as a single topic${answer && answer !== suggestedDefault ? " (user override)" : ""} — running the existing build pipeline unchanged.\n`
      );
      await runBuildCommand([input]);
      return;
    }
    console.log(
      `\n[goal-harness] Proceeding as a GOAL${answer && answer !== suggestedDefault ? " (user override)" : ""} — building a multi-domain path.\n`
    );

    const persisted = await decomposeAndPersistPath(input, { db, onProgress });
    console.log(
      `\n[goal-harness] Path ${persisted.pathId}: ${persisted.domainCount} domain(s), ${persisted.topicCount} topic(s).`
    );

    console.log("\n[goal-harness] Running overlap detection against existing MasteryState/course data...");
    let roadmap = await runOverlapDetectionForPath(persisted.pathId, { db, onProgress });
    printRoadmap(roadmap);

    for (;;) {
      const generatable = roadmap.filter((t) => isTopicGeneratable(t, roadmap));
      if (generatable.length === 0) {
        const remaining = roadmap.filter((t) => t.status === "pending" || t.status === "delta_needed");
        console.log(
          remaining.length === 0
            ? "\n[goal-harness] Every topic is linked/mastered — path complete."
            : "\n[goal-harness] No topic is generatable right now (all remaining ones are waiting on an earlier tier)."
        );
        break;
      }

      console.log("\nGeneratable now:");
      generatable.forEach((t, i) => console.log(`  ${i + 1}. [${t.domainName}] ${t.topicName} (${t.status})`));
      const pick = (await rl.question('\nPick a number to generate, or "done" to stop: ')).trim().toLowerCase();
      if (pick === "done" || pick === "") break;

      const index = Number(pick) - 1;
      const chosen = generatable[index];
      if (!chosen) {
        console.log("Not a valid choice — try again.");
        continue;
      }

      try {
        const result = await generateTopicCourse(chosen.id, { db, onProgress });
        console.log(
          `\n[goal-harness] Generated ${result.wasDelta ? "delta " : ""}course ${result.courseId} for "${chosen.topicName}" ` +
            `(${result.moduleCount} module(s), ${result.lessonCount} lesson(s)).`
        );
      } catch (error) {
        if (error instanceof ResearchPipelineError || error instanceof CourseBuilderError) {
          console.error(`\n[goal-harness] Generation failed for "${chosen.topicName}": ${error.message}`);
        } else {
          throw error;
        }
      }

      roadmap = await loadPathRoadmap(persisted.pathId, { db });
      printRoadmap(roadmap);
    }
  } catch (error) {
    if (error instanceof PathPlannerError) {
      console.error(`\n[goal-harness] ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    rl.close();
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
