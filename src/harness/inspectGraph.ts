#!/usr/bin/env node
import "dotenv/config";
import { getTopicHistory, closeMemoryGraph } from "../memoryGraph/index.js";

/**
 * Dumps whatever's currently stored for a topic in the Memory Graph — nodes,
 * facts, and recent episodes, with dates. Same purpose as `npm run inspect`
 * for SQLite: the only way to verify a graph write actually round-tripped
 * without a UI. Requires `docker compose up` running in mcp_server/ — see
 * README.
 *
 * Episode processing is asynchronous server-side (add_memory queues and
 * returns immediately; Graphiti's own LLM-based extraction runs in the
 * background) — if you just ran `build`, the topic node/facts may not be
 * queryable yet. Re-run this command after a few seconds if it looks empty.
 */
async function main(): Promise<void> {
  const topic = process.argv.slice(2).join(" ").trim();
  if (!topic) {
    console.error('Usage: npm run inspect-graph -- "<topic>"');
    process.exitCode = 1;
    return;
  }

  const history = await getTopicHistory(topic);

  if (history.error) {
    console.error(`\n[inspect-graph] Could not read the Memory Graph: ${history.error}`);
    console.error("[inspect-graph] Is `docker compose up` running in mcp_server/? See README.");
    process.exitCode = 1;
    return;
  }

  console.log(`\nMemory Graph history for topic: "${topic}"`);

  console.log(`\n  Nodes (${history.nodes.length}):`);
  for (const node of history.nodes) {
    console.log(`    - ${node.name} [${node.labels.join(", ") || "no labels"}] (uuid: ${node.uuid}, created: ${node.created_at ?? "unknown"})`);
    if (node.summary) console.log(`        ${node.summary}`);
  }

  console.log(`\n  Facts (${history.facts.length}):`);
  for (const fact of history.facts) {
    console.log(`    - ${fact.fact}`);
    console.log(`        valid_at: ${fact.valid_at ?? "unknown"}, invalid_at: ${fact.invalid_at ?? "still valid"}`);
  }

  console.log(`\n  Recent episodes (${history.episodes.length}, not filtered by topic — server default group):`);
  for (const episode of history.episodes) {
    console.log(`    - "${episode.name}" (created: ${episode.created_at ?? "unknown"}, source: ${episode.source})`);
  }

  if (history.nodes.length === 0 && history.facts.length === 0) {
    console.log(
      "\n  Nothing found yet. If you just ran `build`, episode processing is asynchronous — wait a " +
        "few seconds and try again. Otherwise confirm docker compose is up and the topic string matches."
    );
  }
}

main()
  .catch((error) => {
    console.error("[inspect-graph] Failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMemoryGraph();
  });
