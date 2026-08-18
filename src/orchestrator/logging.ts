import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { OrchestratorLogRecord } from "./types.js";

const LOG_PATH =
  process.env.ORCHESTRATOR_LOG_PATH && process.env.ORCHESTRATOR_LOG_PATH.length > 0
    ? process.env.ORCHESTRATOR_LOG_PATH
    : "logs/orchestrator.jsonl";

export function getLogPath(): string {
  return LOG_PATH;
}

/** Appends one JSONL record per Orchestrator call — cost, latency, prompt version, outcome. */
export async function logOrchestratorCall(
  record: OrchestratorLogRecord
): Promise<void> {
  await mkdir(dirname(LOG_PATH), { recursive: true });
  await appendFile(LOG_PATH, `${JSON.stringify(record)}\n`, "utf-8");
}
