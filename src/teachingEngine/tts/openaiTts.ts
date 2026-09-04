import type { TTSProvider, TTSResult } from "./types.js";

export class OpenAiTtsError extends Error {}

const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";

export interface OpenAiTtsProviderOptions {
  apiKey?: string;
  /** Default "tts-1" — cost-optimal ($15/1M chars vs. "tts-1-hd"'s $30/1M chars, both current as of this project's Phase 7.5 build). "tts-1-hd" or "gpt-4o-mini-tts" are documented, swappable alternates via OPENAI_TTS_MODEL, not a reason to change this default. */
  model?: string;
  voice?: string;
  responseFormat?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
  speed?: number;
}

const CONTENT_TYPE_BY_FORMAT: Record<string, string> = {
  mp3: "audio/mpeg",
  opus: "audio/opus",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  pcm: "audio/pcm",
};

/**
 * Adapter over OpenAI's real /v1/audio/speech endpoint — confirmed directly from OpenAI's own API
 * reference (POST https://api.openai.com/v1/audio/speech, Authorization: Bearer <key>, body
 * {model, input, voice, response_format, speed}, response = raw binary audio bytes by default),
 * not guessed. `stream_format: "sse"` exists upstream but is explicitly unsupported on
 * "tts-1"/"tts-1-hd" — this project's default model — so no per-call streaming is attempted here;
 * "streaming, chunked by paragraph/section" (PRD §5.6) is achieved at the CHUNK level instead (one
 * synthesize() call per lesson chunk, each independently cacheable — see
 * app/api/lessons/[id]/audio/route.ts), not within a single call's response body.
 */
export class OpenAiTtsProvider implements TTSProvider {
  readonly name = "openai";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly voice: string;
  private readonly responseFormat: NonNullable<OpenAiTtsProviderOptions["responseFormat"]>;
  private readonly speed: number;

  constructor(options: OpenAiTtsProviderOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.model = options.model ?? process.env.OPENAI_TTS_MODEL ?? "tts-1";
    this.voice = options.voice ?? "alloy";
    this.responseFormat = options.responseFormat ?? "mp3";
    this.speed = options.speed ?? 1.0;
    if (!this.apiKey) {
      console.warn(
        "[openaiTts] OPENAI_API_KEY is not set — every synthesize() call will fail. Set TTS_PROVIDER=browser for local dev without a key."
      );
    }
  }

  async synthesize(text: string): Promise<TTSResult> {
    if (!this.apiKey) {
      throw new OpenAiTtsError("OPENAI_API_KEY is not set — cannot call OpenAI TTS.");
    }

    const response = await fetch(OPENAI_SPEECH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
        voice: this.voice,
        response_format: this.responseFormat,
        speed: this.speed,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new OpenAiTtsError(`OpenAI TTS request failed (${response.status}): ${body.slice(0, 500)}`);
    }

    const audio = Buffer.from(await response.arrayBuffer());
    return { audio, contentType: CONTENT_TYPE_BY_FORMAT[this.responseFormat] ?? "audio/mpeg" };
  }
}
