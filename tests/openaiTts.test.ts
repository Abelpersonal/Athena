import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAiTtsProvider, OpenAiTtsError } from "../src/teachingEngine/tts/openaiTts.js";

describe("OpenAiTtsProvider", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("calls the real OpenAI /v1/audio/speech endpoint with the confirmed request shape", async () => {
    const mockAudioBytes = new Uint8Array([1, 2, 3, 4]);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => mockAudioBytes.buffer,
    });

    const provider = new OpenAiTtsProvider({ apiKey: "test-key" });
    const result = await provider.synthesize("Hello, this is a test chunk.");

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-key");

    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      model: "tts-1",
      input: "Hello, this is a test chunk.",
      voice: "alloy",
      response_format: "mp3",
      speed: 1.0,
    });

    expect(result.audio).toBeInstanceOf(Buffer);
    expect(result.audio.length).toBe(4);
    expect(result.contentType).toBe("audio/mpeg");
  });

  it("respects an overridden model (e.g. OPENAI_TTS_MODEL / explicit option)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    const provider = new OpenAiTtsProvider({ apiKey: "test-key", model: "tts-1-hd" });
    await provider.synthesize("text");

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(JSON.parse(init.body).model).toBe("tts-1-hd");
  });

  it("throws OpenAiTtsError without ever calling fetch when no API key is configured", async () => {
    const provider = new OpenAiTtsProvider({ apiKey: "" });
    await expect(provider.synthesize("text")).rejects.toThrow(OpenAiTtsError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("throws OpenAiTtsError with the response body on a non-ok HTTP response", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    });
    const provider = new OpenAiTtsProvider({ apiKey: "test-key" });
    await expect(provider.synthesize("text")).rejects.toThrow(/429/);
  });
});
