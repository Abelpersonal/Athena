#!/usr/bin/env node
import "dotenv/config";
import { webSearch, closeWebSearch } from "../mcp/webSearch.js";
import { run } from "../orchestrator/index.js";
import { getLogPath } from "../orchestrator/logging.js";

/**
 * Minimal debugging CLI (Deliverable 3): topic -> webSearch() -> Orchestrator
 * summarize_text -> print structured result. Proves the two deliverables
 * work together end-to-end against real APIs. Scrappy on purpose — this is a
 * debugging tool across Phases 1-6, not a product surface.
 */
async function main(): Promise<void> {
  const topic = process.argv.slice(2).join(" ").trim();
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
    {
      text: combinedText || `No search results were found for "${topic}".`,
      maxWords: 120,
    },
    "harness-cli"
  );

  console.log("\n[harness] Structured result:");
  console.log(JSON.stringify(result, null, 2));
  console.log(`\n[harness] JSONL log written to: ${getLogPath()}`);
}

main()
  .catch((error) => {
    console.error("[harness] Failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeWebSearch();
  });
