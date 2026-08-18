import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, LLMCallParams, LLMCallResult, LLMFinishReason } from "./types.js";

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
    const response = await anthropic.messages.create({
      model: params.model,
      max_tokens: params.maxTokens,
      system: params.systemPrompt,
      thinking: params.thinking ? { type: "adaptive" } : { type: "disabled" },
      output_config: { effort: params.effort },
      messages: [{ role: "user", content: params.userPrompt }],
    });

    const textBlock = response.content.find(isTextBlock);
    return {
      text: textBlock?.text ?? "",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      finishReason: mapStopReason(response.stop_reason),
    };
  }
}
