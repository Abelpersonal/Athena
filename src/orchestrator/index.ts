import Anthropic from "@anthropic-ai/sdk";
// Side-effect import: registers the built-in prompt templates (see templates/index.ts).
import "./templates/index.js";
import { getTemplate } from "./templates/registry.js";
import { validateResponse, buildRetryPrompt } from "./validate.js";
import { logOrchestratorCall } from "./logging.js";
import { estimateCostUsd } from "./pricing.js";
import type { OrchestratorResult } from "./types.js";

const DEFAULT_MODEL = process.env.ORCHESTRATOR_MODEL || "claude-sonnet-5";
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

export interface RunOptions {
  /** Max retries after the first attempt before surfacing a hard failure. Default: ORCHESTRATOR_MAX_RETRIES env var, or 2. */
  maxRetries?: number;
  /** Override the model for this call. Default: ORCHESTRATOR_MODEL env var, or a mid/high-tier current model. */
  model?: string;
}

let sharedClient: Anthropic | null = null;
function getClient(): Anthropic {
  if (!sharedClient) {
    sharedClient = new Anthropic();
  }
  return sharedClient;
}

function isTextBlock(block: Anthropic.ContentBlock): block is Anthropic.TextBlock {
  return block.type === "text";
}

/**
 * The Orchestrator / Prompt Engineer's single public entry point. Every
 * calling module (agent) uses this instead of importing @anthropic-ai/sdk
 * directly.
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
  const model = options.model || DEFAULT_MODEL;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const anthropic = getClient();

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

    let response: Anthropic.Message;
    try {
      response = await anthropic.messages.create({
        model,
        max_tokens: template.maxTokens ?? 2048,
        system: template.systemPrompt,
        thinking: template.thinking ? { type: "adaptive" } : { type: "disabled" },
        output_config: { effort: template.effort ?? "low" },
        messages: [{ role: "user", content: userPrompt }],
      });
    } catch (error) {
      await finalizeFailure(`API call failed: ${(error as Error).message}`);
      throw error;
    }

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    const textBlock = response.content.find(isTextBlock);
    lastRaw = textBlock?.text ?? "";

    if (response.stop_reason === "refusal") {
      lastError = "Model refused the request";
      await finalizeFailure(lastError);
      throw new OrchestratorError(
        `Model refused task "${taskType}" after ${attempts} attempt(s)`,
        attempts,
        lastRaw
      );
    }

    const validation = validateResponse<T>(template.outputSchema, lastRaw);
    if (validation.success) {
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
        data: validation.data,
        attempts,
        raw: lastRaw,
      };
    }

    lastError = validation.error;
    userPrompt = buildRetryPrompt(originalUserPrompt, lastRaw, validation.error);
  }

  await finalizeFailure(lastError);
  throw new OrchestratorError(
    `Orchestrator failed after ${attempts} attempt(s) for task "${taskType}": ${lastError}`,
    attempts,
    lastRaw
  );
}

export { registerTemplate, getTemplate, listTaskTypes } from "./templates/registry.js";
export type { PromptTemplate, OrchestratorResult, EffortLevel } from "./types.js";
