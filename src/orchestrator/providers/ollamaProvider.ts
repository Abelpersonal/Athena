import http from "node:http";
import https from "node:https";
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
 * chosen for the native endpoint's `think` request field / `message.thinking` response field,
 * which give `thinking` a REAL mapping (see below) — the OpenAI-compat shim doesn't expose this in
 * the same documented, verified way, which would have forced `thinking` into the same "no real
 * equivalent, explicitly no-op" bucket as `effort` for no good reason.
 *
 * Uses Node's classic `node:http`/`node:https` client, NOT the global `fetch()` — a deliberate
 * correction after two real, live-confirmed failures with `fetch()` (which is built on undici):
 *
 * 1. `stream: false` (the first attempt): Ollama sends ZERO response bytes — not even HTTP
 *    headers — until an entire non-streamed generation finishes. `fetch()`'s underlying undici
 *    Agent has a default `headersTimeout` of exactly 300 seconds (confirmed directly in the
 *    installed `undici` package's own source, `lib/dispatcher/client.js`:
 *    `this[kHeadersTimeout] = headersTimeout != null ? headersTimeout : 300e3`), which a real,
 *    CPU-only generation on a genuinely non-trivial prompt exceeds — confirmed live, several real
 *    research-pipeline calls against `qwen2.5:7b` on a 6-core/12-thread CPU took 300+ seconds and
 *    died with `HeadersTimeoutError`.
 * 2. `stream: true` (the second attempt): this fixes the GENERATION phase (confirmed live: a real
 *    ~162-second, 358-token generation streamed continuously start to finish once headers arrived
 *    quickly) but not the PROMPT-EVALUATION phase — Ollama still sends zero bytes, headers
 *    included, while it's still digesting a long input context, before generating even the first
 *    output token. Confirmed live: a real `extract_grounded_key_points` call against substantial
 *    real source material failed at ~300-302 seconds with the identical `HeadersTimeoutError`,
 *    even with `stream: true` already in place, because prompt evaluation alone exceeded undici's
 *    300-second ceiling before any bytes — headers included — were ever sent.
 *
 * A custom undici `dispatcher`/`Agent` with a longer `headersTimeout` was tried as a third option
 * and rejected: the externally-installed `undici` npm package's `Agent` isn't accepted by Node's
 * own internal, built-in `fetch` implementation in this Node version — confirmed live,
 * `InvalidArgumentError: invalid onRequestStart method` — a real version-compatibility dead end.
 *
 * `node:http`/`node:https` (Node's original, foundational HTTP client, entirely separate from
 * undici) impose no such hidden default timeout at all — a request only times out if this code
 * explicitly asks it to (via the shared `AbortSignal` from `withTimeout`/
 * `ORCHESTRATOR_REQUEST_TIMEOUT_MS`, the same bound the other two providers already respect), so a
 * slow prompt-eval phase, a slow generation phase, or both together are bounded by exactly one
 * timeout this codebase actually controls, with no second, shorter, invisible ceiling underneath
 * it. `stream: true` is kept regardless (still correct and still useful — the NDJSON parsing below
 * is unchanged), it's just no longer load-bearing for the timeout problem specifically.
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
    return this.attemptCall(params, timeoutMs, params.thinking);
  }

  /**
   * `think` is a separate parameter here (not read straight off `params.thinking`) because of a
   * real, live-confirmed Ollama behavior this codebase's earlier docs-only research missed: a
   * model that structurally can't do extended reasoning (confirmed live against a real running
   * Ollama instance — `qwen2.5:7b` rejects `think: true` with `400 "<model>" does not support
   * thinking`) does NOT silently ignore the field the way the docs alone suggested — it refuses
   * the whole request. This is a real, structural difference from the two hosted providers: a
   * non-reasoning Claude/Gemini model just answers normally when `thinking: true` is requested;
   * a non-reasoning Ollama model hard-rejects the call outright. Retried exactly once, with
   * `think` omitted entirely, so a template that requests thinking still gets a real answer (just
   * without extended reasoning) instead of a hard crash — the closest graceful degradation this
   * provider can offer for a capability the specific local model genuinely doesn't have. `think:
   * false`/omitted was independently confirmed NOT to trigger this rejection on the same model, so
   * the retry is unconditionally safe. This is why `getProvider()`/this provider can't validate
   * "will this model support thinking" up front the way `validateEnv()` validates presence: it
   * depends on the specific local model, not just on `LLM_PROVIDER=ollama` being selected.
   */
  private async attemptCall(params: LLMCallParams, timeoutMs: number, think: boolean): Promise<LLMCallResult> {
    const { status, body: raw } = await withTimeout("Ollama /api/chat", timeoutMs, (signal) =>
      this.postChat(params, think, signal)
    );

    if (status < 200 || status >= 300) {
      // Confirmed live: an error (e.g. the "does not support thinking" 400 above) comes back as a
      // single, complete, non-streamed JSON body even when `stream: true` was requested — Ollama
      // rejects the request before generation (and therefore before any streaming) ever begins.
      if (think && status === 400 && raw.includes("does not support thinking")) {
        return this.attemptCall(params, timeoutMs, false);
      }
      throw new OllamaError(`Ollama /api/chat request failed (${status}): ${raw.slice(0, 500)}`);
    }

    // NDJSON: one JSON object per line, each carrying an incremental `message.content` fragment;
    // the final line (`done: true`) also carries the aggregate metadata (`done_reason`,
    // `prompt_eval_count`, `eval_count`) this function needs.
    let content = "";
    let doneReason: string | undefined;
    let promptEvalCount = 0;
    let evalCount = 0;
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const chunk = JSON.parse(trimmed) as OllamaChatResponse;
      if (chunk.message?.content) content += chunk.message.content;
      if (chunk.done_reason !== undefined) doneReason = chunk.done_reason;
      if (chunk.prompt_eval_count !== undefined) promptEvalCount = chunk.prompt_eval_count;
      if (chunk.eval_count !== undefined) evalCount = chunk.eval_count;
    }

    return {
      text: content,
      inputTokens: promptEvalCount,
      // eval_count (from the final chunk) is already the total output token count, thinking
      // tokens included — Ollama doesn't split them out the way Gemini's thoughtsTokenCount does,
      // so there's nothing separate to fold in here.
      outputTokens: evalCount,
      finishReason: mapDoneReason(doneReason),
    };
  }

  /**
   * Raw `node:http`/`node:https` POST — see the class doc comment for why this isn't `fetch()`.
   * Resolves with the full response body text (the NDJSON stream, concatenated) and status code;
   * never resolves/rejects based on status code itself, so `attemptCall` above can inspect a
   * non-2xx response's body (needed for the "does not support thinking" retry).
   */
  private postChat(params: LLMCallParams, think: boolean, signal: AbortSignal): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.baseUrl}/api/chat`);
      const transport = url.protocol === "https:" ? https : http;
      const payload = JSON.stringify({
        model: params.model,
        messages: [
          { role: "system", content: params.systemPrompt },
          { role: "user", content: params.userPrompt },
        ],
        stream: true,
        // Omitted entirely rather than sent as `false` when not requested — confirmed live that
        // either form is safe on a non-reasoning model, but omitting keeps the request payload
        // minimal and mirrors GeminiProvider's own conditional-inclusion style for the same idea.
        ...(think ? { think: true } : {}),
        options: { num_predict: params.maxTokens },
        // `params.effort` (LLMCallParams) is deliberately NOT sent here — Ollama's real request
        // shape has no "effort"/verbosity-tier concept at all, unlike Anthropic's own
        // `output_config.effort`. Explicitly no-opped, the same choice GeminiProvider already
        // makes for the same reason — accepted only to satisfy the shared `LLMCallParams`
        // interface, with zero effect on the actual request.
      });

      const req = transport.request(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
          signal,
          // Deliberately no `timeout` option here — see the class doc comment. The caller's own
          // AbortSignal is the only bound on this request; node:http/https impose no hidden
          // default of their own the way undici's fetch()-backing Agent does.
        },
        (res) => {
          let body = "";
          res.setEncoding("utf-8");
          res.on("data", (chunk: string) => {
            body += chunk;
          });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
          res.on("error", reject);
        }
      );
      req.on("error", reject);
      req.write(payload);
      req.end();
    });
  }
}
