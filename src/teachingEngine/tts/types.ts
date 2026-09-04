/** Result of synthesizing one chunk's text into audio — vendor-neutral, mirrors LLMCallResult (src/orchestrator/providers/types.ts). */
export interface TTSResult {
  audio: Buffer;
  /** MIME type of `audio`, e.g. "audio/mpeg" — set by the provider that actually produced the bytes, since response_format is provider-specific. */
  contentType: string;
}

/**
 * Implemented once per TTS vendor. Route handlers (app/api/lessons/[id]/audio/) only ever talk to
 * this interface — mirrors LLMProvider (src/orchestrator/providers/types.ts) exactly, same
 * "swappable adapter" discipline this codebase already applies to search (SearchProvider),
 * the LLM vendor (LLMProvider), and the Memory Graph client.
 */
export interface TTSProvider {
  readonly name: string;
  synthesize(text: string): Promise<TTSResult>;
}
