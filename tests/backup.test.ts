import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDbBackup, timestampForBackup } from "../src/harness/backup.js";

describe("timestampForBackup", () => {
  it("produces a filesystem-safe string (no colons or dots from ISO formatting)", () => {
    const ts = timestampForBackup(new Date("2026-03-14T09:26:53.589Z"));
    expect(ts).toBe("2026-03-14T09-26-53-589Z");
    expect(ts).not.toMatch(/[:.]/);
  });
});

describe("createDbBackup", () => {
  let tmpDir: string;
  let dbPath: string;
  let backupDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "teacher-backup-test-"));
    dbPath = path.join(tmpDir, "source.db");
    backupDir = path.join(tmpDir, "backups");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("produces a real, independently-openable SQLite file whose data exactly matches the source at backup time", async () => {
    const sourceDb = new DatabaseSync(dbPath);
    sourceDb.exec("CREATE TABLE courses (id TEXT PRIMARY KEY, topic TEXT NOT NULL)");
    sourceDb.prepare("INSERT INTO courses VALUES (?, ?)").run("crs_1", "Newton's Laws");
    sourceDb.close();

    const backupPath = await createDbBackup(dbPath, backupDir, new Date("2026-01-01T00:00:00.000Z"));

    expect(existsSync(backupPath)).toBe(true);
    expect(backupPath).toContain("teacher-2026-01-01T00-00-00-000Z.db");

    const restoredDb = new DatabaseSync(backupPath, { readOnly: true });
    const rows = restoredDb.prepare("SELECT id, topic FROM courses").all();
    restoredDb.close();

    expect(rows).toEqual([{ id: "crs_1", topic: "Newton's Laws" }]);
  });

  it("captures data written to the source before the backup, and NOT data written after it", async () => {
    const sourceDb = new DatabaseSync(dbPath);
    sourceDb.exec("CREATE TABLE t (v TEXT)");
    sourceDb.prepare("INSERT INTO t VALUES (?)").run("before-backup");
    sourceDb.close();

    const backupPath = await createDbBackup(dbPath, backupDir);

    const sourceDb2 = new DatabaseSync(dbPath);
    sourceDb2.prepare("INSERT INTO t VALUES (?)").run("after-backup");
    sourceDb2.close();

    const restoredDb = new DatabaseSync(backupPath, { readOnly: true });
    const rows = restoredDb.prepare("SELECT v FROM t").all();
    restoredDb.close();

    expect(rows).toEqual([{ v: "before-backup" }]);
  });

  it("creates the backup directory if it doesn't exist yet", async () => {
    const sourceDb = new DatabaseSync(dbPath);
    sourceDb.exec("CREATE TABLE t (v TEXT)");
    sourceDb.close();

    expect(existsSync(backupDir)).toBe(false);
    await createDbBackup(dbPath, backupDir);
    expect(existsSync(backupDir)).toBe(true);
  });
});
