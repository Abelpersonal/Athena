import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OrchestratorLogRecord } from "../src/orchestrator/types.js";

function sampleRecord(overrides: Partial<OrchestratorLogRecord> = {}): OrchestratorLogRecord {
  return {
    taskType: "summarize_text",
    model: "test-model",
    promptVersion: "v1",
    inputTokens: 100,
    outputTokens: 50,
    estimatedCostUsd: 0.001,
    latencyMs: 250,
    attempts: 1,
    success: true,
    callingModule: "test",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("logOrchestratorCall — JSONL log rotation", () => {
  let tmpDir: string;
  let logPath: string;
  let originalLogPathEnv: string | undefined;
  let originalMaxSizeEnv: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "orchestrator-log-test-"));
    logPath = path.join(tmpDir, "orchestrator.jsonl");
    originalLogPathEnv = process.env.ORCHESTRATOR_LOG_PATH;
    originalMaxSizeEnv = process.env.ORCHESTRATOR_LOG_MAX_SIZE_MB;
  });

  afterEach(() => {
    if (originalLogPathEnv === undefined) delete process.env.ORCHESTRATOR_LOG_PATH;
    else process.env.ORCHESTRATOR_LOG_PATH = originalLogPathEnv;
    if (originalMaxSizeEnv === undefined) delete process.env.ORCHESTRATOR_LOG_MAX_SIZE_MB;
    else process.env.ORCHESTRATOR_LOG_MAX_SIZE_MB = originalMaxSizeEnv;
    rmSync(tmpDir, { recursive: true, force: true });
    vi.resetModules();
  });

  // LOG_PATH is frozen at module load (by design — see logging.ts's own doc comment), so each test
  // needs a genuinely fresh module instance to pick up this test's own ORCHESTRATOR_LOG_PATH.
  async function freshLoggingModule(): Promise<typeof import("../src/orchestrator/logging.js")> {
    vi.resetModules();
    return import("../src/orchestrator/logging.js");
  }

  it("never rotates while comfortably under the configured size threshold", async () => {
    process.env.ORCHESTRATOR_LOG_PATH = logPath;
    process.env.ORCHESTRATOR_LOG_MAX_SIZE_MB = "1";
    const { logOrchestratorCall } = await freshLoggingModule();

    await logOrchestratorCall(sampleRecord());
    await logOrchestratorCall(sampleRecord());
    await logOrchestratorCall(sampleRecord());

    expect(readdirSync(tmpDir)).toEqual(["orchestrator.jsonl"]);
    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(3);
  });

  it("rotates the live file once it crosses the configured size threshold, and the next write starts a fresh one", async () => {
    process.env.ORCHESTRATOR_LOG_PATH = logPath;
    process.env.ORCHESTRATOR_LOG_MAX_SIZE_MB = "0.000001"; // effectively ~1 byte — any real record crosses it
    const { logOrchestratorCall } = await freshLoggingModule();

    await logOrchestratorCall(sampleRecord({ taskType: "first" })); // no file exists yet — nothing to rotate
    await logOrchestratorCall(sampleRecord({ taskType: "second" })); // now over threshold -> rotates before this write

    const files = readdirSync(tmpDir).sort();
    expect(files).toHaveLength(2);
    expect(files).toContain("orchestrator.jsonl");
    const rotated = files.find((f) => f !== "orchestrator.jsonl")!;
    expect(rotated).toMatch(/^orchestrator\..+\.jsonl$/);

    const liveLines = readFileSync(path.join(tmpDir, "orchestrator.jsonl"), "utf-8").trim().split("\n");
    expect(liveLines).toHaveLength(1);
    expect(JSON.parse(liveLines[0]!).taskType).toBe("second");

    const rotatedLines = readFileSync(path.join(tmpDir, rotated), "utf-8").trim().split("\n");
    expect(rotatedLines).toHaveLength(1);
    expect(JSON.parse(rotatedLines[0]!).taskType).toBe("first");
  });

  it("keeps only the most recent MAX_ROTATED_FILES (5) rotated files, deleting older ones", async () => {
    process.env.ORCHESTRATOR_LOG_PATH = logPath;
    process.env.ORCHESTRATOR_LOG_MAX_SIZE_MB = "0.000001";
    const { logOrchestratorCall } = await freshLoggingModule();

    // Every call after the first rotates the file that was already there — 8 calls produce 7
    // rotated files total (the 8th call's own write is still the live file), which retention
    // must trim down to 5.
    for (let i = 0; i < 8; i++) {
      await logOrchestratorCall(sampleRecord({ taskType: `call-${i}` }));
      await new Promise((resolve) => setTimeout(resolve, 5)); // distinct timestamps -> unambiguous filenames/ordering
    }

    const files = readdirSync(tmpDir);
    const rotatedFiles = files.filter((f) => f !== "orchestrator.jsonl");
    expect(rotatedFiles.length).toBe(5);
  });

  it("keeps the newest rotated files, not an arbitrary subset", async () => {
    process.env.ORCHESTRATOR_LOG_PATH = logPath;
    process.env.ORCHESTRATOR_LOG_MAX_SIZE_MB = "0.000001";
    const { logOrchestratorCall } = await freshLoggingModule();

    for (let i = 0; i < 8; i++) {
      await logOrchestratorCall(sampleRecord({ taskType: `call-${i}` }));
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const rotatedFiles = readdirSync(tmpDir)
      .filter((f) => f !== "orchestrator.jsonl")
      .sort(); // filenames embed an ISO timestamp, so lexicographic sort is chronological

    // 8 calls -> 7 rotated files total (call-0 through call-6; call-7 is still the live file).
    // Retention keeps the 5 MOST RECENT rotations (call-2..call-6), dropping the two oldest.
    const contents = rotatedFiles.map((f) => JSON.parse(readFileSync(path.join(tmpDir, f), "utf-8").trim()).taskType);
    expect(contents).toEqual(["call-2", "call-3", "call-4", "call-5", "call-6"]);
  });

  it("falls back to the safe default threshold on a non-numeric override, instead of rotating on every call", async () => {
    process.env.ORCHESTRATOR_LOG_PATH = logPath;
    // Number("not-a-number") -> NaN; without a guard, `stats.size < NaN` is always false, which
    // would rotate on EVERY call — the opposite of a safe fallback. Must behave as if unset.
    process.env.ORCHESTRATOR_LOG_MAX_SIZE_MB = "not-a-number";
    const { logOrchestratorCall } = await freshLoggingModule();

    await expect(logOrchestratorCall(sampleRecord())).resolves.toBeUndefined();
    await expect(logOrchestratorCall(sampleRecord())).resolves.toBeUndefined();
    expect(readdirSync(tmpDir)).toEqual(["orchestrator.jsonl"]);
  });
});
