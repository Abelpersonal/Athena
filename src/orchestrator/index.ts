// Side-effect import: registers the built-in prompt templates (see templates/index.ts).
import "./templates/index.js";
import { getTemplate } from "./templates/registry.js";
import { validateResponse, buildRetryPrompt } from "./validate.js";
import { logOrchestratorCall } from "./logging.js";
import { estimateCostUsd } from "./pricing.js";
import { getProvider } from "./providers/index.js";
import type { OrchestratorResult } from "./types.js";

const DEFAULT_MAX_RETRIES = Number(process.env.ORCHESTRATOR_MAX_RETRIES ?? 2);

export class OrchestratorError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastRaw: string
  ) {
    super(message);
    this.name = "OrchestratorError";
  }
}

export type ValidateExtraResult = { success: true } | { success: false; error: string };

export interface RunOptions {
  /** Max retries after the first attempt before surfacing a hard failure. Default: ORCHESTRATOR_MAX_RETRIES env var, or 2. */
  maxRetries?: number;
  /** Override the model for this call. Default: ORCHESTRATOR_MODEL env var, or the selected provider's own default model. */
  model?: string;
  /**
   * Extra validation beyond the template's static Zod schema, for
   * constraints that depend on this specific call's context rather than the
   * task type in general — e.g. "every cited source_id must be one of the
   * ones actually provided in this call's context", which a schema fixed at
   * template-registration time can't express. Runs only after the schema
   * validates; a failure here is retried exactly like a schema failure
   * (same correction-note-and-retry path, same attempt budget).
   */
  validateExtra?: (data: unknown) => ValidateExtraResult;
}

/**
 * The Orchestrator / Prompt Engineer's single public entry point. Every
 * calling module (agent) uses this instead of importing an LLM SDK directly
 * — the Orchestrator itself only ever talks to the vendor-neutral
 * `LLMProvider` interface (`./providers/`), never to `@anthropic-ai/sdk` or
 * `@google/genai` directly. Which vendor actually runs is selected once via
 * `LLM_PROVIDER` ("anthropic" | "gemini", default "gemini") — see
 * `./providers/index.ts`.
 *
 * Pipeline: receive(taskType, context, callingModule) -> look up template
 * -> inject context -> call model -> validate response -> on failure,
 * rewrite prompt with a correction note and retry (up to maxRetries) ->
 * log cost/latency/prompt version/attempts -> return structured result.
 */
export async function run<T = unknown>(
  taskType: string,
  context: Record<string, unknown>,
  callingModule: string,
  options: RunOptions = {}
): Promise<OrchestratorResult<T>> {
  const template = getTemplate<Record<string, unknown>, T>(taskType);
  const provider = getProvider();
  const model = options.model || process.env.ORCHESTRATOR_MODEL || provider.defaultModel;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  const originalUserPrompt = template.buildUserPrompt(context);
  let userPrompt = originalUserPrompt;
  let attempts = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let lastRaw = "";
  let lastError = "";
  const startedAt = Date.now();

  const finalizeFailure = async (error: string): Promise<void> => {
    await logOrchestratorCall({
      taskType,
      model,
      promptVersion: template.version,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      estimatedCostUsd: estimateCostUsd(model, totalInputTokens, totalOutputTokens),
      latencyMs: Date.now() - startedAt,
      attempts,
      success: false,
      callingModule,
      timestamp: new Date().toISOString(),
      error,
    });
  };

  while (attempts < maxRetries + 1) {
    attempts += 1;

    let result;
    try {
      result = await provider.call({
        model,
        maxTokens: template.maxTokens ?? 2048,
        systemPrompt: template.systemPrompt,
        userPrompt,
        thinking: template.thinking ?? false,
        effort: template.effort ?? "low",
      });
    } catch (error) {
      await finalizeFailure(`API call failed: ${(error as Error).message}`);
      throw error;
    }

    totalInputTokens += result.inputTokens;
    totalOutputTokens += result.outputTokens;
    lastRaw = result.text;

    if (result.finishReason === "refusal") {
      lastError = "Model refused the request";
      await finalizeFailure(lastError);
      throw new OrchestratorError(
        `Model refused task "${taskType}" after ${attempts} attempt(s)`,
        attempts,
        lastRaw
      );
    }

    const validation = validateResponse<T>(template.outputSchema, lastRaw);
    let failureReason: string | null = null;

    if (!validation.success) {
      failureReason = validation.error;
    } else if (options.validateExtra) {
      const extra = options.validateExtra(validation.data);
      if (!extra.success) failureReason = extra.error;
    }

    if (failureReason === null) {
      // validation.success is guaranteed true here (failureReason is only
      // ever null when validation succeeded and validateExtra, if present,
      // also passed) but TS can't see that across the branch above.
      const data = (validation as { success: true; data: T }).data;
      await logOrchestratorCall({
        taskType,
        model,
        promptVersion: template.version,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        estimatedCostUsd: estimateCostUsd(model, totalInputTokens, totalOutputTokens),
        latencyMs: Date.now() - startedAt,
        attempts,
        success: true,
        callingModule,
        timestamp: new Date().toISOString(),
      });
      return {
        taskType,
        promptVersion: template.version,
        data,
        attempts,
        raw: lastRaw,
      };
    }

    lastError = failureReason;
    userPrompt = buildRetryPrompt(originalUserPrompt, lastRaw, failureReason);
  }

  await finalizeFailure(lastError);
  throw new OrchestratorError(
    `Orchestrator failed after ${attempts} attempt(s) for task "${taskType}": ${lastError}`,
    attempts,
    lastRaw
  );
}

export { registerTemplate, getTemplate, listTaskTypes } from "./templates/registry.js";
export { getProvider, resetProviderCache } from "./providers/index.js";
export type { LLMProvider, LLMCallParams, LLMCallResult, LLMFinishReason } from "./providers/index.js";
export type { PromptTemplate, OrchestratorResult, EffortLevel } from "./types.js";
