import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { migrate } from "drizzle-orm/sqlite-proxy/migrator";
import * as schema from "./schema.js";

/**
 * There's no C++ toolchain available to compile better-sqlite3's native
 * binding in this environment (no Visual Studio Build Tools on Windows, and
 * it ships no prebuilt fallback), so the driver here is Node's own built-in
 * `node:sqlite` (stable as of Node 22+) wired into Drizzle's generic
 * sqlite-proxy driver, which just wants an async (sql, params, method)
 * callback — DatabaseSync.prepare(...).run/all/get supplies that directly.
 * `setReturnArrays(true)` makes rows come back as positional arrays, which
 * is the shape sqlite-proxy expects for its own column<->field mapping.
 */
export type TeacherDb = ReturnType<typeof drizzle<typeof schema>>;

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "teacher.db");
const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

interface OpenDb {
  db: TeacherDb;
  raw: DatabaseSync;
}

function openDb(dbPath: string): OpenDb {
  if (dbPath !== ":memory:") {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const raw = new DatabaseSync(dbPath);
  raw.exec("PRAGMA foreign_keys = ON;");

  const db = drizzle<typeof schema>(
    async (sqlText, params, method) => {
      const stmt = raw.prepare(sqlText);
      stmt.setReturnArrays(true);
      const bound = params as SQLInputValue[];
      if (method === "run") {
        stmt.run(...bound);
        return { rows: [] };
      }
      if (method === "get") {
        const row = stmt.get(...bound) as unknown[] | undefined;
        return { rows: row as unknown as unknown[] };
      }
      return { rows: stmt.all(...bound) as unknown[] };
    },
    { schema }
  );

  return { db, raw };
}

let cached: OpenDb | null = null;
let cachedPath: string | null = null;
/**
 * Phase 7: the in-flight open+migrate call, memoized so concurrent getDb() calls for the same
 * path await the SAME migration run instead of each opening their own DatabaseSync handle and
 * racing to apply migrations against the same file — a real, previously-latent bug this codebase
 * never hit before Phase 7's Dashboard, the first caller to Promise.all() several independent
 * reads that each call getDb() with no shared connection passed in (a completely normal Server
 * Component pattern). Without this, a second concurrent call could see `cached` still null (the
 * first call hasn't finished migrating yet) and start its own migrate() against a database that
 * now already has the tables the first call just created, throwing "table already exists".
 * `tests/dbClient.test.ts` exercises this directly with a real concurrent Promise.all().
 */
let pending: Promise<OpenDb> | null = null;
let pendingPath: string | null = null;

async function openAndMigrate(dbPath: string): Promise<OpenDb> {
  const opened = openDb(dbPath);
  await migrate(
    opened.db,
    async (queries) => {
      for (const query of queries) opened.raw.exec(query);
    },
    { migrationsFolder: MIGRATIONS_FOLDER }
  );
  return opened;
}

/**
 * Lazily opens (or reuses) the SQLite connection and applies any pending
 * Drizzle migrations before returning — this is what lets the schema grow
 * phase-by-phase without ever hand-editing a live DB file. Pass ":memory:"
 * (or a tmp-file path) in tests to avoid touching the real data/teacher.db.
 */
export async function getDb(
  dbPath: string = process.env.TEACHER_DB_PATH ?? DEFAULT_DB_PATH
): Promise<TeacherDb> {
  if (cached && cachedPath === dbPath) return cached.db;
  if (pending && pendingPath === dbPath) return (await pending).db;

  pendingPath = dbPath;
  pending = openAndMigrate(dbPath);
  try {
    const opened = await pending;
    cached = opened;
    cachedPath = dbPath;
    return opened.db;
  } finally {
    pending = null;
    pendingPath = null;
  }
}

/**
 * Also closes the cached DatabaseSync handle — previously this just dropped the JS reference and
 * relied on GC, harmless for the ":memory:" paths every pre-Phase-7 test used, but leaves a real
 * file handle locked on Windows until GC eventually runs, which is unreliable and too slow for
 * test cleanup that needs the file gone immediately afterward (tests/dbClient.test.ts's temp-file
 * cleanup surfaced this). Never throws even if the handle is already closed.
 */
export function resetDbCache(): void {
  try {
    cached?.raw.close();
  } catch {
    // already closed — fine
  }
  cached = null;
  cachedPath = null;
  pending = null;
  pendingPath = null;
}
