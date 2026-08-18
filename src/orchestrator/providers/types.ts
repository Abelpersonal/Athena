import type { EffortLevel } from "../types.js";

/** Everything a provider needs to make one LLM call, independent of which vendor it is. */
export interface LLMCallParams {
  model: string;
  maxTokens: number;
  systemPrompt: string;
  userPrompt: string;
  thinking: boolean;
  effort: EffortLevel;
}

/**
 * Normalized across vendors so the Orchestrator's retry/validation logic never
 * has to know which provider produced a response. "refusal" covers both an
 * explicit model refusal (Claude) and a safety/policy content block (Gemini) —
 * both mean the same thing to a caller: don't retry this as a formatting mistake.
 */
export type LLMFinishReason = "end_turn" | "max_tokens" | "refusal" | "other";

export interface LLMCallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  finishReason: LLMFinishReason;
}

/** Implemented once per LLM vendor. The Orchestrator only ever talks to this interface. */
export interface LLMProvider {
  readonly name: string;
  /** Used when neither ORCHESTRATOR_MODEL nor a per-call override is set. */
  readonly defaultModel: string;
  call(params: LLMCallParams): Promise<LLMCallResult>;
}
