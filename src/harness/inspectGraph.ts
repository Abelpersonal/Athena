#!/usr/bin/env node
import "dotenv/config";
import { getTopicHistory, closeMemoryGraph } from "../memoryGraph/index.js";
import { checkGraphDrift, type CourseDriftEntry } from "../memoryGraph/driftCheck.js";
import { getDb, resetDbCache } from "../db/client.js";

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
 *
 * Startup Validation + Drift Check addition: `--drift` runs a read-only reconciliation check
 * across EVERY course in SQLite instead of dumping one topic's raw history — see
 * src/memoryGraph/driftCheck.ts for what it does and doesn't check. A sibling command was
 * considered and rejected in favor of extending this one: they share the same "requires
 * docker compose up, degrades to a clean error rather than crashing if it's not" shape, and
 * `--drift` is this file's first flag-style argument (previously argv was just "everything after
 * the script name is the topic string") — matching `knowledgeUpdate`/`engagementCheck`'s existing
 * `process.argv.includes("--flag")` convention rather than introducing a real argv parser for one
 * flag.
 *   npm run inspect-graph -- --drift
 */
async function main(): Promise<void> {
  if (process.argv.includes("--drift")) {
    await runDriftCheck();
    return;
  }

  const topic = process.argv.slice(2).join(" ").trim();
  if (!topic) {
    console.error('Usage: npm run inspect-graph -- "<topic>"  (or: npm run inspect-graph -- --drift)');
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

function printDriftEntries(entries: CourseDriftEntry[]): void {
  for (const entry of entries) {
    const marker = entry.status === "in_sync" ? "OK   " : "DRIFT";
    console.log(`\n  [${marker}] ${entry.topic} (${entry.courseId}) — ${entry.status}`);
    console.log(`         ${entry.detail}`);
  }
}

async function runDriftCheck(): Promise<void> {
  resetDbCache();
  const db = await getDb();
  const report = await checkGraphDrift({ db });

  if (!report.reachable) {
    console.error(`\n[inspect-graph --drift] Could not check the Memory Graph: ${report.error}`);
    console.error("[inspect-graph --drift] Is `docker compose up` running in mcp_server/? See README.");
    if (report.entries.length > 0) {
      console.log(`\n[inspect-graph --drift] ${report.entries.length} course(s) were checked before the graph became unreachable:`);
      printDriftEntries(report.entries);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`\nMemory Graph drift check — ${report.entries.length} course(s) checked, ${report.driftedCount} drifted.`);
  if (report.entries.length === 0) {
    console.log("\n  No courses in SQLite yet — nothing to check.");
    return;
  }
  printDriftEntries(report.entries);
  if (report.driftedCount === 0) {
    console.log("\n  Clean — every course's graph presence is consistent with SQLite.");
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
