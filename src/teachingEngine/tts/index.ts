import type { TTSProvider } from "./types.js";
import { OpenAiTtsProvider } from "./openaiTts.js";
import { BrowserTtsProvider } from "./browserTts.js";

export type { TTSProvider, TTSResult } from "./types.js";
export { OpenAiTtsProvider, OpenAiTtsError } from "./openaiTts.js";
export { BrowserTtsProvider } from "./browserTts.js";

let sharedProvider: TTSProvider | null = null;
let sharedProviderName: string | null = null;

/**
 * Selects the TTS provider via TTS_PROVIDER ("openai" | "browser"), default "openai" — mirrors
 * getProvider() (src/orchestrator/providers/index.ts) exactly, including the cache-per-selected-
 * name pattern. No silent fallback: "openai" with no OPENAI_API_KEY fails loudly from
 * OpenAiTtsProvider.synthesize() (matching GeminiProvider's own unkeyed behavior), it does not
 * quietly switch to "browser" — that's an explicit, manual dev opt-in, same status as
 * LLM_PROVIDER's own values.
 */
export function getTtsProvider(): TTSProvider {
  const providerName = (process.env.TTS_PROVIDER || "openai").toLowerCase();

  if (sharedProvider && sharedProviderName === providerName) {
    return sharedProvider;
  }

  let provider: TTSProvider;
  switch (providerName) {
    case "openai":
      provider = new OpenAiTtsProvider();
      break;
    case "browser":
      provider = new BrowserTtsProvider();
      break;
    default:
      throw new Error(`Unknown TTS_PROVIDER "${providerName}". Supported values: "openai", "browser".`);
  }

  sharedProvider = provider;
  sharedProviderName = providerName;
  return provider;
}

/** Test-only: forces the next getTtsProvider() call to rebuild instead of reusing the cached instance. */
export function resetTtsProviderCache(): void {
  sharedProvider = null;
  sharedProviderName = null;
}
