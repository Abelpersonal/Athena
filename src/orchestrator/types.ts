import type { z } from "zod";

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * A registered prompt for one task_type: system prompt, how to build the user
 * prompt from caller-supplied context, and the schema the model's response
 * must validate against. This is the unit every calling module plugs into —
 * new agents add templates here rather than hand-building prompts inline.
 */
export interface PromptTemplate<TInput = unknown, TOutput = unknown> {
  taskType: string;
  /** Bumped whenever the prompt text changes, so logged results can be tied to the version that produced them. */
  version: string;
  systemPrompt: string;
  buildUserPrompt: (context: TInput) => string;
  outputSchema: z.ZodType<TOutput>;
  maxTokens?: number;
  effort?: EffortLevel;
  /** Whether to enable adaptive thinking for this task. Off by default — these are short, non-reasoning-heavy tasks. */
  thinking?: boolean;
}

export interface OrchestratorResult<T> {
  taskType: string;
  promptVersion: string;
  data: T;
  attempts: number;
  raw: string;
}

export interface OrchestratorLogRecord {
  taskType: string;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  attempts: number;
  success: boolean;
  callingModule: string;
  timestamp: string;
  error?: string;
}
