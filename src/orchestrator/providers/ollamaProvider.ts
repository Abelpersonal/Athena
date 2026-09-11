import { withTimeout } from "../../shared/timeout.js";
import type { LLMProvider, LLMCallParams, LLMCallResult, LLMFinishReason } from "./types.js";

export class OllamaError extends Error {}

/** Used when the Orchestrator doesn't pass an explicit timeoutMs — see the same constant on the other two providers. */
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_BASE_URL = "http://localhost:11434";

interface OllamaChatResponse {
  message?: { role: string; content: string; thinking?: string };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Confirmed directly against Ollama's real Go source (github.com/ollama/ollama, `llm/server.go`),
 * not guessed from the docs page alone (which doesn't enumerate these): `type DoneReason int` with
 * `DoneReasonStop`/`DoneReasonLength` constants, and a `String()` method mapping
 * `DoneReasonStop -> "stop"`, `DoneReasonLength -> "length"` (a third internal value,
 * `DoneReasonConnectionClosed`, stringifies to `""` and never appears in a completed real
 * response). Ollama's native API has no documented concept of a policy-refusal completion reason
 * the way Anthropic's `stop_reason` or Gemini's safety-related finish reasons do — local
 * open-weight models don't expose that kind of API-visible safety classification — so nothing
 * maps to `"refusal"` here. A refusal from a local model, if the model produces one at all, comes
 * back as ordinary generated text, not a distinct signal this provider could detect.
 */
function mapDoneReason(doneReason: string | undefined): LLMFinishReason {
  if (doneReason === "length") return "max_tokens";
  if (doneReason === "stop") return "end_turn";
  return "other";
}

export interface OllamaProviderOptions {
  baseUrl?: string;
  model?: string;
}

/**
 * The only place Ollama's HTTP API is called outside this file itself. Uses the NATIVE
 * `POST /api/chat` endpoint rather than Ollama's OpenAI-compatible `/v1/chat/completions` shim —
 * chosen over the shim for two concrete reasons, not just "native is more idiomatic": (1) this
 * codebase already has a precedent for a raw `fetch()`-based provider needing no vendor SDK
 * (`src/teachingEngine/tts/openaiTts.ts` calls OpenAI's real REST endpoint directly rather than
 * pulling in the `openai` package), so a new dependency isn't needed either way, and (2) the
 * native endpoint's `think` request field / `message.thinking` response field give `thinking` a
 * REAL mapping (see below) — the OpenAI-compat shim doesn't expose this in the same documented,
 * verified way, which would have forced `thinking` into the same "no real equivalent, explicitly
 * no-op" bucket as `effort` for no good reason.
 *
 * No streaming (`stream: false`) — matches AnthropicProvider/GeminiProvider, both single
 * request/response, and the Orchestrator's retry/validation loop only ever deals with one
 * complete text blob per attempt.
 */
export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  /**
   * No sane default — unlike Claude/Gemini's fixed, versioned model catalog, an Ollama install's
   * available models are entirely local and user-controlled (whatever `ollama pull` has fetched).
   * `validateEnv()` (src/shared/validateEnv.ts) requires `OLLAMA_MODEL` to be set whenever
   * `LLM_PROVIDER=ollama`, so in normal operation this is never actually empty by the time a real
   * call happens; if it somehow is, Ollama's own `/api/chat` rejects an empty/unknown model name
   * with a clear error rather than this provider guessing a model that may not exist locally.
   */
  readonly defaultModel: string;
  private readonly baseUrl: string;

  constructor(options: OllamaProviderOptions = {}) {
    const rawBaseUrl = options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL;
    this.baseUrl = rawBaseUrl.replace(/\/+$/, "");
    this.defaultModel = options.model ?? process.env.OLLAMA_MODEL ?? "";
  }

  async call(params: LLMCallParams): Promise<LLMCallResult> {
    const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const response = await withTimeout("Ollama /api/chat", timeoutMs, (signal) =>
      fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          model: params.model,
          messages: [
            { role: "system", content: params.systemPrompt },
            { role: "user", content: params.userPrompt },
          ],
          stream: false,
          // Real equivalent of "thinking": Ollama's native `think` request field (boolean, or a
          // level string for finer control) toggles extended reasoning for models that support it
          // — confirmed directly against Ollama's real API docs. Passed through as a plain
          // boolean, matching this codebase's own `thinking: boolean` shape; a model that doesn't
          // support thinking simply ignores the field (documented Ollama behavior, not an error),
          // the same way `thinking: true` against a non-reasoning model degrades harmlessly on
          // the other two providers.
          think: params.thinking,
          options: { num_predict: params.maxTokens },
          // `params.effort` (LLMCallParams) is deliberately NOT sent here — Ollama's real request
          // shape (confirmed above) has no "effort"/verbosity-tier concept at all, unlike
          // Anthropic's own `output_config.effort`. Explicitly no-opped, the same choice
          // GeminiProvider already makes for the same reason (confirmed by reading its `call()`
          // method: it never references `params.effort` either) — accepted only to satisfy the
          // shared `LLMCallParams` interface, with zero effect on the actual request.
        }),
      })
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new OllamaError(`Ollama /api/chat request failed (${response.status}): ${body.slice(0, 500)}`);
    }

    const data = (await response.json()) as OllamaChatResponse;
    return {
      text: data.message?.content ?? "",
      inputTokens: data.prompt_eval_count ?? 0,
      // eval_count is already the total output token count, thinking tokens included — Ollama
      // doesn't split them out the way Gemini's thoughtsTokenCount does, so there's nothing
      // separate to fold in here.
      outputTokens: data.eval_count ?? 0,
      finishReason: mapDoneReason(data.done_reason),
    };
  }
}
