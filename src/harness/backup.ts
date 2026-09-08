#!/usr/bin/env node
import "dotenv/config";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { mkdir, cp } from "node:fs/promises";
import path from "node:path";

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "teacher.db");
const DEFAULT_AUDIO_CACHE_DIR = path.join(process.cwd(), "data", "audio-cache");
const BACKUP_DIR = path.join(process.cwd(), "backups");

/** Filesystem-safe timestamp for a backup filename — colons/dots aren't valid in a Windows path. */
export function timestampForBackup(now: Date = new Date()): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

/**
 * Escapes a path for embedding inside a single-quoted SQLite string literal (double any embedded
 * single quote — standard SQL string-literal escaping, since `VACUUM INTO` doesn't support a bound
 * parameter for its destination). `backupPath` below is always internally constructed from a
 * timestamp, never user input, but this is done properly regardless rather than relying on that.
 */
function escapeSqliteStringLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Backup/Export addition, corrected: `node:sqlite` (this codebase's real driver — see
 * src/db/client.ts's own doc comment on why better-sqlite3 isn't used) has no dedicated `.backup()`
 * API the way better-sqlite3 does — confirmed directly, `'backup' in DatabaseSync.prototype` is
 * `false`. The PREVIOUS version of this function used `.serialize()`/`.deserialize()` instead,
 * with a comment claiming that was "confirmed directly" too — it wasn't actually checked against
 * every Node version this app might run on, and `npm run backup` broke with
 * `TypeError: readDb.serialize is not a function` on at least one real environment where those
 * methods (added to `node:sqlite` later than the module's original, more stable surface) aren't
 * present. `exec()`, used here, has been part of `node:sqlite` since its introduction, making this
 * version portable across Node versions this app might actually run on, not just the one most
 * recently tested against.
 *
 * The real fix: SQLite's own `VACUUM INTO 'path'` statement, run via `exec()` on a fresh, separate,
 * READ-ONLY connection to the source file (never the app's own live connection, which this script
 * doesn't need to know about) — SQLite's standard, documented way to produce a consistent,
 * self-contained snapshot of a live database directly to a new file, genuinely respecting "a clean
 * copy while no write is in progress" rather than a naive `cp` that could catch the file mid-write.
 * `VACUUM INTO` refuses to run if the destination already exists, so `backupPath`'s timestamp
 * naming must keep producing a genuinely new filename every call (already true — see
 * `timestampForBackup`). It writes the file itself; there's no intermediate byte buffer to hold or
 * write with a separate `fs` call the way `.serialize()` needed.
 */
export async function createDbBackup(dbPath: string, backupDir: string, now: Date = new Date()): Promise<string> {
  await mkdir(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `teacher-${timestampForBackup(now)}.db`);

  const readDb = new DatabaseSync(dbPath, { readOnly: true });
  try {
    readDb.exec(`VACUUM INTO '${escapeSqliteStringLiteral(backupPath)}'`);
  } finally {
    readDb.close();
  }
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
