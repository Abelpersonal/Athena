import { appendFile, mkdir, stat, rename, readdir, unlink } from "node:fs/promises";
import { dirname, basename, extname, join } from "node:path";
import type { OrchestratorLogRecord } from "./types.js";

const LOG_PATH =
  process.env.ORCHESTRATOR_LOG_PATH && process.env.ORCHESTRATOR_LOG_PATH.length > 0
    ? process.env.ORCHESTRATOR_LOG_PATH
    : "logs/orchestrator.jsonl";

/**
 * JSONL Log Rotation addition. Default 50MB — generous for a personal app's own JSONL audit trail
 * (one line per LLM call), while still small enough that a rotated file stays easy to open/grep by
 * hand rather than growing forever (the exact problem this deliverable fixes). Read fresh on every
 * call (`Number(env ?? default)`), matching this file's own numeric env-var convention used
 * elsewhere in the orchestrator (`ORCHESTRATOR_SESSION_BUDGET_USD`, `ORCHESTRATOR_REQUEST_TIMEOUT_MS`
 * — both function-scoped, not frozen at module load) — unlike `LOG_PATH` above, which genuinely
 * needs to stay a frozen, one-time-computed constant (see rotateLog()'s doc comment for why).
 */
const DEFAULT_MAX_SIZE_MB = 50;

/**
 * How many rotated files to keep before deleting the oldest. A personal app's local log, not a
 * production logging pipeline — unbounded growth of the live file was the problem; unbounded
 * growth of ROTATED files instead would just be the same problem one level removed, so this is a
 * plain constant (not an extra env var) rather than something worth making independently
 * configurable for a single-user app.
 */
const MAX_ROTATED_FILES = 5;

export function getLogPath(): string {
  return LOG_PATH;
}

function getMaxSizeBytes(): number {
  const parsed = Number(process.env.ORCHESTRATOR_LOG_MAX_SIZE_MB);
  // A garbage value (e.g. a typo'd non-numeric override) must fall back to the safe default, not
  // become NaN — `stats.size < NaN` is always false, which would silently rotate on EVERY single
  // call instead of never rotating, the exact opposite of a sane misconfiguration fallback.
  const mb = process.env.ORCHESTRATOR_LOG_MAX_SIZE_MB && !Number.isNaN(parsed) ? parsed : DEFAULT_MAX_SIZE_MB;
  return mb * 1024 * 1024;
}

/** `orchestrator.jsonl` -> `orchestrator.2026-09-08T07-08-11-356Z.jsonl`, alongside the live file. */
function rotatedLogPath(logPath: string, timestamp: string): string {
  const ext = extname(logPath);
  const name = basename(logPath, ext);
  return join(dirname(logPath), `${name}.${timestamp}${ext}`);
}

/** Matches only THIS log file's own rotated siblings in its directory — never an unrelated file that happens to live alongside it. */
function rotatedFilePattern(logPath: string): RegExp {
  const ext = extname(logPath);
  const name = basename(logPath, ext);
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escapeRegex(name)}\\..+${escapeRegex(ext)}$`);
}

/**
 * Renames the current, over-threshold log file out of the way to a timestamped sibling, then
 * deletes the oldest rotated siblings beyond MAX_ROTATED_FILES. `LOG_PATH` itself is never
 * reassigned — it's a frozen module-level constant (see above), and the whole point of rotation is
 * that `getLogPath()` keeps answering the SAME configured path forever; `rename()` just clears
 * whatever currently occupies it, so the append that immediately follows this call recreates a
 * fresh, empty file there — exactly like the very first call this process ever made.
 */
async function rotateLog(logPath: string): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  await rename(logPath, rotatedLogPath(logPath, timestamp));

  const dir = dirname(logPath);
  const pattern = rotatedFilePattern(logPath);
  const entries = await readdir(dir);
  // ISO-derived timestamps in the filename sort chronologically as plain strings.
  const rotatedFiles = entries.filter((entry) => pattern.test(entry)).sort();

  const toDelete = rotatedFiles.slice(0, Math.max(0, rotatedFiles.length - MAX_ROTATED_FILES));
  for (const file of toDelete) {
    // Best-effort: a stale rotated file that fails to delete (e.g. permissions) is a minor disk-
    // space annoyance, never a reason to fail the real Orchestrator call this log entry belongs to.
    await unlink(join(dir, file)).catch(() => {});
  }
}

/**
 * Checked once at the top of every logOrchestratorCall(), before the append. Deliberately swallows
 * every failure (missing file, a rename race, a readdir/unlink error) rather than letting rotation
 * bookkeeping ever throw out of logOrchestratorCall() — every real call site in
 * src/orchestrator/index.ts awaits this with no try/catch of its own (this file's write was always
 * meant to be a fire-and-forget audit trail, never something that could break the LLM call it's
 * recording), so a bug here must degrade to "the log grows a bit past its threshold this once,"
 * never to "a real course-generation run crashes over log bookkeeping."
 */
async function maybeRotate(logPath: string): Promise<void> {
  try {
    const stats = await stat(logPath);
    if (stats.size < getMaxSizeBytes()) return;
    await rotateLog(logPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return; // no file yet — nothing to rotate
    console.error(`[orchestrator-logging] Log rotation check failed (continuing without rotating): ${(error as Error).message}`);
  }
}

/** Appends one JSONL record per Orchestrator call — cost, latency, prompt version, outcome. */
export async function logOrchestratorCall(
  record: OrchestratorLogRecord
): Promise<void> {
  await mkdir(dirname(LOG_PATH), { recursive: true });
  await maybeRotate(LOG_PATH);
  await appendFile(LOG_PATH, `${JSON.stringify(record)}\n`, "utf-8");
}
