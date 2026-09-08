#!/usr/bin/env node
import "dotenv/config";
import path from "node:path";
import { runEngagementCheck } from "./index.js";
import { getDb, resetDbCache } from "../db/client.js";
import { validateEnv } from "../shared/validateEnv.js";

/**
 * The engagement nudge's standalone scheduled-job script (Phase 10, Deliverable 5) —
 * `npm run engagement-check [-- --dry-run]`. Same shape as `src/knowledgeUpdate/cli.ts`: meant to
 * be wired to a real OS-level cron entry (see README for a crontab example), not run as a
 * persistent daemon inside the app. Idempotent by construction (isEngagementNudgeDue's cadence
 * gate — see src/motivation/pure.ts) — running it twice in a row against the same still-quiet
 * stretch is a safe no-op.
 *
 * `--dry-run` mirrors `knowledge-update --dry-run`'s convention: an isolated `data/teacher.dry-
 * run.db` and — since sending a real push needs a real subscribed browser, which a CLI dry run
 * can never have — a logged-only mock send instead of a real VAPID-signed request.
 */
async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`[engagement-check] Starting${dryRun ? " (--dry-run: mocked push send, isolated DB)" : ""}...`);
  validateEnv({ skip: dryRun });

  resetDbCache();
  const db = await getDb(dryRun ? path.join(process.cwd(), "data", "teacher.dry-run.db") : undefined);
  const onProgress = (message: string) => console.log(`[engagement-check] ${message}`);

  const result = await runEngagementCheck({
    db,
    onProgress,
    ...(dryRun
      ? {
          sendPushToAllSubscriptions: async (payload) => {
            console.log(`[engagement-check] (dry-run) Would send push: ${JSON.stringify(payload)}`);
            return { sent: 0, removedStale: 0 };
          },
        }
      : {}),
  });

  console.log(`\n[engagement-check] Done. nudgeSent=${result.nudgeSent} reason=${result.reason}`);
}

main().catch((error) => {
  console.error("[engagement-check] Failed:", error);
  process.exitCode = 1;
});
