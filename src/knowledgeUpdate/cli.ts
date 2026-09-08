#!/usr/bin/env node
import "dotenv/config";
import path from "node:path";
import { runKnowledgeUpdateAgent } from "./index.js";
import { getDb, resetDbCache } from "../db/client.js";
import { closeWebSearch } from "../mcp/webSearch.js";
import { closeYoutubeTranscript } from "../mcp/youtubeTranscript.js";
import { closeMemoryGraph } from "../memoryGraph/index.js";
import { createMockOrchestratorRun, createMockSearchProvider, mockFetchAndClean } from "../harness/mocks.js";
import { validateEnv } from "../shared/validateEnv.js";

/**
 * The Knowledge Update Agent's standalone scheduled-job script (Phase 6, Deliverable 3) —
 * `npm run knowledge-update [-- --dry-run]`. Deliberately its OWN entrypoint, not a
 * `src/harness/cli.ts` subcommand: the PRD frames this as "run manually or via external
 * scheduler... not a persistent daemon inside the app" (no heavy job-queue infra), so it's meant
 * to be wired to a real OS-level cron entry (see README for a crontab example) rather than run
 * through the general debugging harness. Idempotent by construction — see
 * runKnowledgeUpdateAgent's doc comment — so running it twice in a row with nothing new due is a
 * safe no-op, exactly what a cron entry needs.
 *
 * `--dry-run` mirrors `build --dry-run`'s convention (mocked LLM/search/extraction, isolated
 * `data/teacher.dry-run.db`) for deterministically validating the full severity-routing pipeline
 * without spending real API calls or depending on TAVILY_API_KEY/a reachable Memory Graph service.
 */
async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`[knowledge-update] Starting${dryRun ? " (--dry-run: mocked, no real API calls, isolated DB)" : ""}...`);
  validateEnv({ skip: dryRun });

  resetDbCache();
  const db = await getDb(dryRun ? path.join(process.cwd(), "data", "teacher.dry-run.db") : undefined);
  const onProgress = (message: string) => console.log(`[knowledge-update] ${message}`);

  const startedAt = Date.now();
  const result = await runKnowledgeUpdateAgent({
    db,
    onProgress,
    ...(dryRun
      ? {
          orchestratorRun: createMockOrchestratorRun(),
          searchProvider: createMockSearchProvider(),
          fetchAndClean: mockFetchAndClean,
        }
      : {}),
  });
  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(`\n[knowledge-update] Done in ${elapsedSeconds}s${dryRun ? " (dry run)" : ""}.`);
  console.log(`[knowledge-update] Topics checked: ${result.topicsChecked}`);
  console.log(
    `[knowledge-update] Events: ${result.eventsBySeverity.major} major, ${result.eventsBySeverity.moderate} moderate, ${result.eventsBySeverity.minor} minor.`
  );
  if (result.topicsChecked === 0) {
    console.log("[knowledge-update] Nothing due — no-op run.");
  }
}

main()
  .catch((error) => {
    console.error("[knowledge-update] Failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeWebSearch();
    await closeMemoryGraph();
    await closeYoutubeTranscript();
  });
