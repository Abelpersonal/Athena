import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getDb, resetDbCache } from "../src/db/client.js";
import { courses } from "../src/db/schema.js";

describe("getDb concurrency (Phase 7 regression)", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    resetDbCache();
    tmpDir = mkdtempSync(path.join(tmpdir(), "teacher-db-test-"));
    dbPath = path.join(tmpDir, "concurrent.db");
  });

  afterEach(() => {
    resetDbCache(); // closes the DatabaseSync handle so the temp dir isn't locked on Windows
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Before the fix, two concurrent getDb() calls for the same FRESH file path both saw the
   * module-level `cached` var as null (caching only happens AFTER the first call's migrate()
   * resolves), so both opened their own DatabaseSync handle onto the SAME on-disk file and raced
   * to run migrate() against it — the second one threw "table already exists". A real
   * node:sqlite ":memory:" path wouldn't reproduce this (each connection gets its own isolated
   * in-memory database, so there's nothing to race over) — this is why a real temp FILE is used
   * here, matching the exact shape of the bug this codebase actually hit: Next.js Server
   * Components doing `Promise.all([getDb-backed reads])`, which nothing before Phase 7 exercised.
   */
  it("does not throw when called concurrently for the same fresh file path", async () => {
    const [dbA, dbB, dbC] = await Promise.all([getDb(dbPath), getDb(dbPath), getDb(dbPath)]);
    expect(dbA).toBeDefined();
    expect(dbB).toBeDefined();
    expect(dbC).toBeDefined();
  });

  it("all concurrent callers receive the SAME underlying connection, not separate ones", async () => {
    const [dbA, dbB] = await Promise.all([getDb(dbPath), getDb(dbPath)]);

    // Insert via one, read via the other — only possible if they share the same connection/migrated schema.
    await dbA.insert(courses).values({
      id: "crs_concurrency_test",
      topic: "Concurrency Test",
      createdAt: new Date().toISOString(),
      volatilityTier: "medium",
      status: "building",
    });
    const rows = await dbB.select().from(courses);
    expect(rows.map((r) => r.id)).toContain("crs_concurrency_test");
  });
});
