import { GoogleGenAI, FinishReason, ThinkingLevel, ApiError } from "@google/genai";
import { withTimeout } from "../../shared/timeout.js";
import type { LLMProvider, LLMCallParams, LLMCallResult, LLMFinishReason } from "./types.js";

/** HTTP statuses worth retrying: rate-limited or transient server/overload errors. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_TRANSIENT_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;
/** Used when the Orchestrator doesn't pass an explicit timeoutMs (e.g. a test constructing LLMCallParams directly) — the real caller always supplies one via ORCHESTRATOR_REQUEST_TIMEOUT_MS. */
const DEFAULT_TIMEOUT_MS = 60_000;

function isRetryableError(error: unknown): boolean {
  return error instanceof ApiError && RETRYABLE_STATUSES.has(error.status);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapFinishReason(reason: FinishReason | undefined): LLMFinishReason {
  switch (reason) {
    case FinishReason.STOP:
      return "end_turn";
    case FinishReason.MAX_TOKENS:
      return "max_tokens";
    case FinishReason.SAFETY:
    case FinishReason.PROHIBITED_CONTENT:
    case FinishReason.RECITATION:
    case FinishReason.BLOCKLIST:
    case FinishReason.SPII:
      return "refusal";
    default:
      return "other";
  }
}

/**
 * The only place @google/genai is imported outside this file itself. Wraps
 * Gemini's generateContent behind the vendor-neutral LLMProvider interface —
 * this, not the newer "Interactions" surface also exposed by this SDK, is the
 * mature, stable API and is what this provider is built against.
 */
export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  readonly defaultModel = "gemini-3.7-flash";
  private client: GoogleGenAI | null = null;

  constructor(private readonly apiKey?: string) {}

  private getClient(): GoogleGenAI {
    if (!this.client) {
      this.client = new GoogleGenAI(this.apiKey ? { apiKey: this.apiKey } : {});
    }
    return this.client;
  }

  async call(params: LLMCallParams): Promise<LLMCallResult> {
    const ai = this.getClient();
    const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // The Anthropic SDK retries transient 429/5xx errors by default; @google/genai
    // does not, so that behavior is replicated here rather than surfacing a
    // "high demand, try again" error straight to the Orchestrator (which would
    // burn one of its own validation-retry attempts on a request that was never
    // actually served, and log a misleading validation-style failure for it).
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
      if (attempt > 0) {
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
      }
      try {
        // Both `httpOptions.timeout` (the SDK's own internal enforcement, first line of defense
        // on real infrastructure — confirmed live in its source: it arms its own
        // setTimeout(() => controller.abort(), timeout) around the real fetch) and `abortSignal`
        // (this attempt's own AbortController, sourced from withTimeout) are passed on the SAME
        // GenerateContentConfig the SDK already exposes for exactly this purpose, not two
        // competing mechanisms. `abortSignal` is what makes a genuine hang provably bounded under
        // a mocked SDK in tests, where the SDK's own internal timeout (buried inside the real
        // `generateContent()` we mock away) can't be exercised at all. A fresh signal/timer per
        // retry attempt, matching the SDK's own "fresh signal per attempt" precedent.
        const response = await withTimeout("Gemini generateContent", timeoutMs, (signal) =>
          ai.models.generateContent({
            model: params.model,
            contents: params.userPrompt,
            config: {
              systemInstruction: params.systemPrompt,
              maxOutputTokens: params.maxTokens,
              // Best-effort JSON hint — the Orchestrator's own parse-and-validate-and-retry
              // loop remains the actual enforcement mechanism (see validate.ts), so this
              // isn't relied on for correctness, only for nudging the raw-text success rate up.
              responseMimeType: "application/json",
              httpOptions: { timeout: timeoutMs },
              abortSignal: signal,
              // thinkingBudget: 0 is documented as DISABLED, but confirmed live (400
              // invalid_argument) that at least gemini-3.6-flash rejects it outright —
              // thinkingLevel: MINIMAL is the level-based control and is accepted, so
              // that's used instead to keep cost/latency down on non-reasoning tasks.
              // When the template wants thinking on, omit thinkingConfig entirely and
              // let the model's own default apply, rather than guessing a specific level.
              ...(params.thinking ? {} : { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } }),
              // `params.effort` (LLMCallParams) is deliberately NOT sent here — the Gemini API has
              // no equivalent of Anthropic's `output_config.effort` verbosity/thoroughness tier at
              // all. Explicitly no-opped, accepted only to satisfy the shared `LLMCallParams`
              // interface; it has zero effect on the actual request against this provider.
            },
          })
        );

        const usage = response.usageMetadata;
        return {
          text: response.text ?? "",
          inputTokens: usage?.promptTokenCount ?? 0,
          // Thinking tokens are billed as output tokens, so they're folded in here for
          // an accurate cost estimate — Claude has no equivalent split to account for.
          outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
          finishReason: mapFinishReason(response.candidates?.[0]?.finishReason),
        };
      } catch (error) {
        lastError = error;
        if (!isRetryableError(error)) throw error;
      }
    }
    throw lastError;
  }
}
