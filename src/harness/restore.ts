#!/usr/bin/env node
import "dotenv/config";
import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "teacher.db");

/**
 * Backup/Export addition: the corresponding restore half of `npm run backup`. Deliberately the
 * simplest thing that could work for a personal, single-user, local-first app — copy the chosen
 * backup file over the live `TEACHER_DB_PATH`. It can't stop a running app for you (there's no
 * process-management layer in this codebase to hook into), so it just warns loudly and proceeds —
 * matching this deliverable's own stated bar ("a full interactive restore command is nice but not
 * required if the manual process is simple and well-documented"); this is that same manual
 * process, just as a real command instead of README-only prose, since the underlying operation
 * (one file copy) was simple enough to make real with no added complexity.
 */
async function main(): Promise<void> {
  const backupFile = process.argv[2];
  if (!backupFile) {
    console.error("Usage: npm run restore -- <backup-file>");
    console.error("List available backups with: ls backups/");
    process.exitCode = 1;
    return;
  }
  if (!existsSync(backupFile)) {
    console.error(`[restore] Backup file not found: ${backupFile}`);
    process.exitCode = 1;
    return;
  }

  const dbPath = process.env.TEACHER_DB_PATH ?? DEFAULT_DB_PATH;
  console.warn(
    "[restore] Make sure the app (npm run dev, and any harness/knowledge-update/engagement-check " +
      "process) is stopped before restoring — this overwrites the live database file, which a " +
      "running process may still have open."
  );
  await mkdir(path.dirname(dbPath), { recursive: true });
  await copyFile(backupFile, dbPath);
  console.log(`[restore] Restored: ${backupFile} -> ${dbPath}`);
}

main().catch((error) => {
  console.error("[restore] Failed:", error);
  process.exitCode = 1;
});
