import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockAnthropicCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(function MockAnthropic() {
    return { messages: { create: mockAnthropicCreate } };
  }),
}));

const mockGeminiGenerateContent = vi.fn();
vi.mock("@google/genai", async () => {
  const actual = await vi.importActual<typeof import("@google/genai")>("@google/genai");
  return {
    ...actual,
    GoogleGenAI: vi.fn().mockImplementation(function MockGoogleGenAI() {
      return { models: { generateContent: mockGeminiGenerateContent } };
    }),
  };
});

const { AnthropicProvider } = await import("../src/orchestrator/providers/anthropicProvider.js");
const { GeminiProvider } = await import("../src/orchestrator/providers/geminiProvider.js");
const { getProvider, resetProviderCache } = await import("../src/orchestrator/providers/index.js");
const { ApiError } = await import("@google/genai");
const { TimeoutError } = await import("../src/shared/timeout.js");

const baseParams = {
  model: "test-model",
  maxTokens: 100,
  systemPrompt: "sys",
  userPrompt: "user",
  thinking: false,
  effort: "low" as const,
};

describe("AnthropicProvider", () => {
  beforeEach(() => mockAnthropicCreate.mockReset());

  it("maps a successful text response and translates thinking/effort", async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "hello" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 7 },
    });

    const provider = new AnthropicProvider();
    const result = await provider.call({ ...baseParams, thinking: false, effort: "low" });

    expect(result).toEqual({ text: "hello", inputTokens: 5, outputTokens: 7, finishReason: "end_turn" });
    const callArgs = mockAnthropicCreate.mock.calls[0]![0];
    expect(callArgs.thinking).toEqual({ type: "disabled" });
    expect(callArgs.output_config).toEqual({ effort: "low" });
  });

  it("requests adaptive thinking when thinking: true", async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "x" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const provider = new AnthropicProvider();
    await provider.call({ ...baseParams, thinking: true, effort: "high" });

    const callArgs = mockAnthropicCreate.mock.calls[0]![0];
    expect(callArgs.thinking).toEqual({ type: "adaptive" });
  });

  it("maps a refusal stop_reason to finishReason: refusal", async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [],
      stop_reason: "refusal",
      usage: { input_tokens: 5, output_tokens: 0 },
    });

    const provider = new AnthropicProvider();
    const result = await provider.call(baseParams);
    expect(result.finishReason).toBe("refusal");
  });

  it("maps a max_tokens stop_reason to finishReason: max_tokens", async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "truncated" }],
      stop_reason: "max_tokens",
      usage: { input_tokens: 5, output_tokens: 100 },
    });

    const provider = new AnthropicProvider();
    const result = await provider.call(baseParams);
    expect(result.finishReason).toBe("max_tokens");
  });
});

describe("AnthropicProvider timeout (Timeouts + Hard Cost Cap, Deliverable 1)", () => {
  beforeEach(() => {
    mockAnthropicCreate.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("times out with a TimeoutError (not hanging forever) when messages.create never resolves", async () => {
    mockAnthropicCreate.mockImplementation(() => new Promise(() => {})); // simulates a genuine hang

    const provider = new AnthropicProvider();
    const resultPromise = provider.call({ ...baseParams, timeoutMs: 5000 });
    const assertion = expect(resultPromise).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it("passes a real timeout + AbortSignal through to messages.create's RequestOptions", async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "hello" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const provider = new AnthropicProvider();
    await provider.call({ ...baseParams, timeoutMs: 12345 });

    const [, options] = mockAnthropicCreate.mock.calls[0]!;
    expect(options.timeout).toBe(12345);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("GeminiProvider", () => {
  beforeEach(() => mockGeminiGenerateContent.mockReset());

  it("maps a successful text response", async () => {
    mockGeminiGenerateContent.mockResolvedValueOnce({
      text: "hello from gemini",
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7 },
      candidates: [{ finishReason: "STOP" }],
    });

    const provider = new GeminiProvider("test-key");
    const result = await provider.call(baseParams);

    expect(result).toEqual({
      text: "hello from gemini",
      inputTokens: 5,
      outputTokens: 7,
      finishReason: "end_turn",
    });
  });

  it("includes thoughtsTokenCount in outputTokens (thinking tokens are billed as output)", async () => {
    mockGeminiGenerateContent.mockResolvedValueOnce({
      text: "answer",
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7, thoughtsTokenCount: 20 },
      candidates: [{ finishReason: "STOP" }],
    });

    const provider = new GeminiProvider("test-key");
    const result = await provider.call({ ...baseParams, thinking: true });

    expect(result.outputTokens).toBe(27);
  });

  it("requests thinkingLevel MINIMAL when thinking: false, and omits thinkingConfig when thinking: true", async () => {
    // thinkingBudget: 0 is documented as DISABLED but was confirmed live to be
    // rejected (400 invalid_argument) by at least gemini-3.6-flash — thinkingLevel:
    // MINIMAL is the accepted level-based equivalent. See geminiProvider.ts.
    mockGeminiGenerateContent.mockResolvedValue({
      text: "x",
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      candidates: [{ finishReason: "STOP" }],
    });
    const provider = new GeminiProvider("test-key");

    await provider.call({ ...baseParams, thinking: false });
    const disabledCallArgs = mockGeminiGenerateContent.mock.calls[0]![0];
    expect(disabledCallArgs.config.thinkingConfig).toEqual({ thinkingLevel: "MINIMAL" });

    await provider.call({ ...baseParams, thinking: true });
    const enabledCallArgs = mockGeminiGenerateContent.mock.calls[1]![0];
    expect(enabledCallArgs.config.thinkingConfig).toBeUndefined();
  });

  it("maps a SAFETY finish reason to finishReason: refusal", async () => {
    mockGeminiGenerateContent.mockResolvedValueOnce({
      text: "",
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 0 },
      candidates: [{ finishReason: "SAFETY" }],
    });

    const provider = new GeminiProvider("test-key");
    const result = await provider.call(baseParams);
    expect(result.finishReason).toBe("refusal");
  });

  it("maps a MAX_TOKENS finish reason to finishReason: max_tokens", async () => {
    mockGeminiGenerateContent.mockResolvedValueOnce({
      text: "truncated",
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 100 },
      candidates: [{ finishReason: "MAX_TOKENS" }],
    });

    const provider = new GeminiProvider("test-key");
    const result = await provider.call(baseParams);
    expect(result.finishReason).toBe("max_tokens");
  });

  it("handles a missing text/usageMetadata/candidates gracefully", async () => {
    mockGeminiGenerateContent.mockResolvedValueOnce({});

    const provider = new GeminiProvider("test-key");
    const result = await provider.call(baseParams);

    expect(result).toEqual({ text: "", inputTokens: 0, outputTokens: 0, finishReason: "other" });
  });

  it("passes systemPrompt and maxTokens through to the request config", async () => {
    mockGeminiGenerateContent.mockResolvedValueOnce({
      text: "x",
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      candidates: [{ finishReason: "STOP" }],
    });

    const provider = new GeminiProvider("test-key");
    await provider.call({ ...baseParams, systemPrompt: "custom system prompt", maxTokens: 4096 });

    const callArgs = mockGeminiGenerateContent.mock.calls[0]![0];
    expect(callArgs.config.systemInstruction).toBe("custom system prompt");
    expect(callArgs.config.maxOutputTokens).toBe(4096);
    expect(callArgs.contents).toBe("user");
  });
});

describe("GeminiProvider retry on transient errors", () => {
  beforeEach(() => {
    mockGeminiGenerateContent.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries a 503 and succeeds once the transient error clears", async () => {
    mockGeminiGenerateContent
      .mockRejectedValueOnce(new ApiError({ message: "high demand", status: 503 }))
      .mockResolvedValueOnce({
        text: "recovered",
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        candidates: [{ finishReason: "STOP" }],
      });

    const provider = new GeminiProvider("test-key");
    const resultPromise = provider.call(baseParams);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.text).toBe("recovered");
    expect(mockGeminiGenerateContent).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-retryable error (e.g. 400 bad request)", async () => {
    mockGeminiGenerateContent.mockRejectedValueOnce(new ApiError({ message: "bad request", status: 400 }));

    const provider = new GeminiProvider("test-key");
    await expect(provider.call(baseParams)).rejects.toThrow("bad request");
    expect(mockGeminiGenerateContent).toHaveBeenCalledTimes(1);
  });

  it("gives up after exhausting retries on a persistent 503", async () => {
    mockGeminiGenerateContent.mockRejectedValue(new ApiError({ message: "still down", status: 503 }));

    const provider = new GeminiProvider("test-key");
    const resultPromise = provider.call(baseParams);
    const assertion = expect(resultPromise).rejects.toThrow("still down");
    await vi.runAllTimersAsync();
    await assertion;

    // 1 initial attempt + 3 retries = 4 total calls.
    expect(mockGeminiGenerateContent).toHaveBeenCalledTimes(4);
  });

  it("times out with a TimeoutError (not hanging forever, and not retried as if transient) when generateContent never resolves", async () => {
    mockGeminiGenerateContent.mockImplementation(() => new Promise(() => {})); // simulates a genuine hang

    const provider = new GeminiProvider("test-key");
    const resultPromise = provider.call({ ...baseParams, timeoutMs: 5000 });
    const assertion = expect(resultPromise).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;

    // A timeout is not an ApiError, so isRetryableError() correctly says no — retrying a genuine
    // hang would just hang again for the same duration, not recover like a real transient 503 does.
    expect(mockGeminiGenerateContent).toHaveBeenCalledTimes(1);
  });

  it("passes a real timeout (httpOptions.timeout) + abortSignal through to generateContent's config", async () => {
    mockGeminiGenerateContent.mockResolvedValueOnce({
      text: "x",
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      candidates: [{ finishReason: "STOP" }],
    });

    const provider = new GeminiProvider("test-key");
    await provider.call({ ...baseParams, timeoutMs: 12345 });

    const [callArgs] = mockGeminiGenerateContent.mock.calls[0]!;
    expect(callArgs.config.httpOptions).toEqual({ timeout: 12345 });
    expect(callArgs.config.abortSignal).toBeInstanceOf(AbortSignal);
  });
});

describe("getProvider (provider selection)", () => {
  const originalProvider = process.env.LLM_PROVIDER;

  afterEach(() => {
    resetProviderCache();
    if (originalProvider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = originalProvider;
  });

  it("defaults to gemini when LLM_PROVIDER is unset", () => {
    delete process.env.LLM_PROVIDER;
    resetProviderCache();
    expect(getProvider().name).toBe("gemini");
  });

  it("selects anthropic when LLM_PROVIDER=anthropic", () => {
    process.env.LLM_PROVIDER = "anthropic";
    resetProviderCache();
    expect(getProvider().name).toBe("anthropic");
  });

  it("is case-insensitive", () => {
    process.env.LLM_PROVIDER = "ANTHROPIC";
    resetProviderCache();
    expect(getProvider().name).toBe("anthropic");
  });

  it("throws a clear error for an unknown LLM_PROVIDER value", () => {
    process.env.LLM_PROVIDER = "bogus";
    resetProviderCache();
    expect(() => getProvider()).toThrow(/Unknown LLM_PROVIDER/);
  });

  it("caches the provider instance across calls with the same selection", () => {
    process.env.LLM_PROVIDER = "gemini";
    resetProviderCache();
    const first = getProvider();
    const second = getProvider();
    expect(first).toBe(second);
  });
});
