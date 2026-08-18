import type { LLMProvider } from "./types.js";
import { AnthropicProvider } from "./anthropicProvider.js";
import { GeminiProvider } from "./geminiProvider.js";

export type { LLMProvider, LLMCallParams, LLMCallResult, LLMFinishReason } from "./types.js";
export { AnthropicProvider } from "./anthropicProvider.js";
export { GeminiProvider } from "./geminiProvider.js";

let sharedProvider: LLMProvider | null = null;
let sharedProviderName: string | null = null;

/**
 * Selects the LLM provider via LLM_PROVIDER ("anthropic" | "gemini"), default
 * "gemini". Cached per selected provider name so repeated calls reuse one
 * client — matches each provider's own internal lazy-client pattern.
 */
export function getProvider(): LLMProvider {
  const providerName = (process.env.LLM_PROVIDER || "gemini").toLowerCase();

  if (sharedProvider && sharedProviderName === providerName) {
    return sharedProvider;
  }

  let provider: LLMProvider;
  switch (providerName) {
    case "anthropic":
      provider = new AnthropicProvider();
      break;
    case "gemini":
      provider = new GeminiProvider(process.env.GEMINI_API_KEY);
      break;
    default:
      throw new Error(
        `Unknown LLM_PROVIDER "${providerName}". Supported values: "anthropic", "gemini".`
      );
  }

  sharedProvider = provider;
  sharedProviderName = providerName;
  return provider;
}

/** Test-only: forces the next getProvider() call to rebuild instead of reusing the cached instance. */
export function resetProviderCache(): void {
  sharedProvider = null;
  sharedProviderName = null;
}
