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
 * Lazily opens (or reuses) the SQLite connection and applies any pending
 * Drizzle migrations before returning — this is what lets the schema grow
 * phase-by-phase without ever hand-editing a live DB file. Pass ":memory:"
 * (or a tmp-file path) in tests to avoid touching the real data/teacher.db.
 */
export async function getDb(
  dbPath: string = process.env.TEACHER_DB_PATH ?? DEFAULT_DB_PATH
): Promise<TeacherDb> {
  if (cached && cachedPath === dbPath) return cached.db;

  const opened = openDb(dbPath);
  await migrate(
    opened.db,
    async (queries) => {
      for (const query of queries) opened.raw.exec(query);
    },
    { migrationsFolder: MIGRATIONS_FOLDER }
  );

  cached = opened;
  cachedPath = dbPath;
  return opened.db;
}

export function resetDbCache(): void {
  cached = null;
  cachedPath = null;
}
