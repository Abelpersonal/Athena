#!/usr/bin/env node
import "dotenv/config";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { mkdir, writeFile, cp } from "node:fs/promises";
import path from "node:path";

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "teacher.db");
const DEFAULT_AUDIO_CACHE_DIR = path.join(process.cwd(), "data", "audio-cache");
const BACKUP_DIR = path.join(process.cwd(), "backups");

/** Filesystem-safe timestamp for a backup filename — colons/dots aren't valid in a Windows path. */
export function timestampForBackup(now: Date = new Date()): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

/**
 * Backup/Export addition: `node:sqlite` (this codebase's real driver — see src/db/client.ts's own
 * doc comment on why better-sqlite3 isn't used) has no dedicated `.backup()` API the way
 * better-sqlite3 does; confirmed directly (`'backup' in DatabaseSync.prototype` is `false` in the
 * installed Node version). What it DOES have is `.serialize()`/`.deserialize()` — SQLite's own C
 * API for producing/reading a byte-for-byte-consistent snapshot of a database's current state.
 * That's the real equivalent here, used on a fresh, separate, READ-ONLY connection to the source
 * file (never the app's own live connection, which this script doesn't need to know about) —
 * genuinely respecting "a clean copy while no write is in progress" rather than a naive `cp` that
 * could catch the file mid-write, exactly as this deliverable asked for.
 */
export async function createDbBackup(dbPath: string, backupDir: string, now: Date = new Date()): Promise<string> {
  await mkdir(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `teacher-${timestampForBackup(now)}.db`);

  const readDb = new DatabaseSync(dbPath, { readOnly: true });
  let bytes: Uint8Array;
  try {
    bytes = readDb.serialize();
  } finally {
    readDb.close();
  }
  await writeFile(backupPath, bytes);
  return backupPath;
}

/**
 * Personal, local-first, single-user app scope decision (documented in README): no cloud backup,
 * no scheduled-backup infrastructure — a manual, on-demand command is the whole of this
 * deliverable, same "don't over-build for a personal app" call this project has made repeatedly
 * elsewhere (e.g. `npm run knowledge-update`/`engagement-check` are meant to be wired to an
 * external OS-level cron entry, not a daemon this app runs itself).
 *
 * `--include-audio` is opt-in, not automatic: the audio cache is pure, regenerable derived data
 * (re-synthesizable from lesson text — see src/teachingEngine/audioCache.ts) and can be large,
 * so it's excluded from the default backup rather than silently ballooning every routine run.
 */
async function main(): Promise<void> {
  const dbPath = process.env.TEACHER_DB_PATH ?? DEFAULT_DB_PATH;
  const includeAudio = process.argv.includes("--include-audio");

  if (!existsSync(dbPath)) {
    console.error(`[backup] No database file found at ${dbPath} — nothing to back up.`);
    process.exitCode = 1;
    return;
  }

  const backupPath = await createDbBackup(dbPath, BACKUP_DIR);
  console.log(`[backup] Database backed up: ${dbPath} -> ${backupPath}`);

  if (includeAudio) {
    const audioDir = process.env.AUDIO_CACHE_DIR ?? DEFAULT_AUDIO_CACHE_DIR;
    if (existsSync(audioDir)) {
      const audioBackupPath = path.join(BACKUP_DIR, `audio-cache-${timestampForBackup()}`);
      await cp(audioDir, audioBackupPath, { recursive: true });
      console.log(`[backup] Audio cache backed up: ${audioDir} -> ${audioBackupPath}`);
    } else {
      console.log(`[backup] --include-audio was passed, but no audio cache directory exists at ${audioDir} — skipped.`);
    }
  }
}

main().catch((error) => {
  console.error("[backup] Failed:", error);
  process.exitCode = 1;
});
