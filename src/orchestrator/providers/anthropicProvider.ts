import Anthropic from "@anthropic-ai/sdk";
import { withTimeout } from "../../shared/timeout.js";
import type { LLMProvider, LLMCallParams, LLMCallResult, LLMFinishReason } from "./types.js";

/** Used when the Orchestrator doesn't pass an explicit timeoutMs (e.g. a test constructing LLMCallParams directly) — the real caller always supplies one via ORCHESTRATOR_REQUEST_TIMEOUT_MS. */
const DEFAULT_TIMEOUT_MS = 60_000;

function isTextBlock(block: Anthropic.ContentBlock): block is Anthropic.TextBlock {
  return block.type === "text";
}

function mapStopReason(stopReason: string | null): LLMFinishReason {
  if (stopReason === "refusal") return "refusal";
  if (stopReason === "max_tokens") return "max_tokens";
  if (stopReason === "end_turn" || stopReason === "stop_sequence") return "end_turn";
  return "other";
}

/**
 * The only place @anthropic-ai/sdk is imported outside this file itself.
 * Wraps Claude's Messages API behind the vendor-neutral LLMProvider interface.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly defaultModel = "claude-sonnet-5";
  private client: Anthropic | null = null;

  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic();
    }
    return this.client;
  }

  async call(params: LLMCallParams): Promise<LLMCallResult> {
    const anthropic = this.getClient();
    const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    // Both `timeout` (the SDK's own internal enforcement, first line of defense on real
    // infrastructure) and `signal` (this call's own AbortController, sourced from withTimeout)
    // are passed on the SAME RequestOptions object the SDK already exposes for exactly this
    // purpose — not two competing mechanisms. `signal` is what makes a genuine hang provably
    // bounded under a mocked SDK in tests, where the SDK's own internal `timeout` enforcement
    // (buried inside the real `messages.create()` we mock away) can't be exercised at all.
    const response = await withTimeout("Anthropic messages.create", timeoutMs, (signal) =>
      anthropic.messages.create(
        {
          model: params.model,
          max_tokens: params.maxTokens,
          system: params.systemPrompt,
          thinking: params.thinking ? { type: "adaptive" } : { type: "disabled" },
          output_config: { effort: params.effort },
          messages: [{ role: "user", content: params.userPrompt }],
        },
        { timeout: timeoutMs, signal }
      )
    );

    const textBlock = response.content.find(isTextBlock);
    return {
      text: textBlock?.text ?? "",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      finishReason: mapStopReason(response.stop_reason),
    };
  }
}
