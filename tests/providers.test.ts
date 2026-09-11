import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

// OllamaProvider uses node:http (never fetch/undici — see its own doc comment for why), so its
// tests mock the request() entry point on both node:http and node:https rather than global.fetch.
const mockHttpRequest = vi.fn();
vi.mock("node:http", () => ({ default: { request: (...args: unknown[]) => mockHttpRequest(...args) } }));
vi.mock("node:https", () => ({ default: { request: (...args: unknown[]) => mockHttpRequest(...args) } }));

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
const { OllamaProvider, OllamaError } = await import("../src/orchestrator/providers/ollamaProvider.js");
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

describe("OllamaProvider", () => {
  interface CapturedRequest {
    url: URL;
    options: Record<string, unknown>;
    writtenBody: string;
  }
  let capturedRequests: CapturedRequest[] = [];

  beforeEach(() => {
    capturedRequests = [];
    mockHttpRequest.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * OllamaProvider uses node:http/https directly, never fetch() — see its own class doc comment
   * for the real, live-confirmed reasons (undici's default 300s headersTimeout killing genuinely
   * slow CPU-only local generations, in a way `stream: true` alone didn't fully fix either). This
   * builds a fake `http.request`-shaped implementation: a request object (write/end) and, once
   * `.end()` is called, invokes the real request callback with a response object (a real
   * `EventEmitter`, matching Node's own `IncomingMessage`) emitting the given status/body.
   */
  function ollamaHttpImpl(status: number, bodyLines: string[]) {
    return (url: URL, options: Record<string, unknown>, callback: (res: EventEmitter & { statusCode: number }) => void) => {
      const entry: CapturedRequest = { url, options, writtenBody: "" };
      capturedRequests.push(entry);
      const req = new EventEmitter() as EventEmitter & { write: (chunk: string) => void; end: () => void };
      req.write = vi.fn((chunk: string) => {
        entry.writtenBody += chunk;
      });
      req.end = vi.fn(() => {
        const res = new EventEmitter() as EventEmitter & { statusCode: number; setEncoding: (enc: string) => void };
        res.statusCode = status;
        res.setEncoding = vi.fn();
        callback(res);
        res.emit("data", bodyLines.join("\n"));
        res.emit("end");
      });
      return req;
    };
  }

  /** Simulates a real streamed (NDJSON) Ollama response — one or more lines, matching the real
   * wire format (see the class doc comment: `stream: true` is always sent now). */
  function mockOllamaHttp(status: number, bodyLines: string[]): void {
    mockHttpRequest.mockImplementation(ollamaHttpImpl(status, bodyLines));
  }

  it("calls the real Ollama /api/chat endpoint with the confirmed request shape", async () => {
    mockOllamaHttp(200, [
      JSON.stringify({
        message: { role: "assistant", content: "hello from ollama" },
        done_reason: "stop",
        prompt_eval_count: 10,
        eval_count: 5,
      }),
    ]);

    const provider = new OllamaProvider({ baseUrl: "http://localhost:11434", model: "llama3.2" });
    const result = await provider.call({ ...baseParams, model: "llama3.2" });

    expect(mockHttpRequest).toHaveBeenCalledTimes(1);
    const { url, options, writtenBody } = capturedRequests[0]!;
    expect(url.toString()).toBe("http://localhost:11434/api/chat");
    expect(options.method).toBe("POST");
    expect((options.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

    const body = JSON.parse(writtenBody);
    expect(body).toMatchObject({
      model: "llama3.2",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "user" },
      ],
      stream: true,
      options: { num_predict: 100 },
    });
    // think is omitted entirely (not sent as false) when thinking wasn't requested — confirmed
    // live that a real Ollama instance accepts both forms equally when thinking is off, but this
    // keeps the payload minimal, and omission is required (see the retry test below) for the
    // "true" case since some real local models reject the field outright rather than ignore it.
    expect(body.think).toBeUndefined();
    // effort is deliberately never sent — no Ollama request field corresponds to it.
    expect(body.effort).toBeUndefined();

    expect(result).toEqual({
      text: "hello from ollama",
      inputTokens: 10,
      outputTokens: 5,
      finishReason: "end_turn",
    });
  });

  it("accumulates message.content across a real multi-chunk NDJSON stream, taking metadata only from the final (done: true) line", async () => {
    // Reproduces the real shape a streamed /api/chat response actually takes — several partial
    // chunks (no metadata yet) followed by one final chunk carrying done_reason/token counts.
    mockOllamaHttp(200, [
      JSON.stringify({ message: { role: "assistant", content: "The " } }),
      JSON.stringify({ message: { role: "assistant", content: "answer " } }),
      JSON.stringify({ message: { role: "assistant", content: "is 42." } }),
      JSON.stringify({
        message: { role: "assistant", content: "" },
        done: true,
        done_reason: "stop",
        prompt_eval_count: 20,
        eval_count: 7,
      }),
    ]);

    const provider = new OllamaProvider({ model: "llama3.2" });
    const result = await provider.call(baseParams);

    expect(result).toEqual({
      text: "The answer is 42.",
      inputTokens: 20,
      outputTokens: 7,
      finishReason: "end_turn",
    });
  });

  it("passes thinking: true through as the real `think` request field", async () => {
    mockOllamaHttp(200, [JSON.stringify({ message: { content: "reasoned answer" }, done_reason: "stop" })]);

    const provider = new OllamaProvider({ model: "deepseek-r1" });
    await provider.call({ ...baseParams, thinking: true });

    expect(JSON.parse(capturedRequests[0]!.writtenBody).think).toBe(true);
  });

  it("retries once with think omitted when the model rejects thinking outright (real, live-confirmed Ollama behavior on qwen2.5:7b)", async () => {
    mockHttpRequest
      .mockImplementationOnce(ollamaHttpImpl(400, ['{"error":"\\"qwen2.5:7b\\" does not support thinking"}']))
      .mockImplementationOnce(
        ollamaHttpImpl(200, [JSON.stringify({ message: { content: "answered without thinking" }, done_reason: "stop" })])
      );

    const provider = new OllamaProvider({ model: "qwen2.5:7b" });
    const result = await provider.call({ ...baseParams, thinking: true });

    expect(mockHttpRequest).toHaveBeenCalledTimes(2);
    expect(JSON.parse(capturedRequests[0]!.writtenBody).think).toBe(true);
    expect(capturedRequests[1]!.writtenBody.includes('"think"')).toBe(false);
    expect(result.text).toBe("answered without thinking");
  });

  it("does NOT retry a 400 for an unrelated reason (only the exact 'does not support thinking' message triggers the fallback)", async () => {
    mockOllamaHttp(400, ['{"error":"some other validation error"}']);

    const provider = new OllamaProvider({ model: "qwen2.5:7b" });
    await expect(provider.call({ ...baseParams, thinking: true })).rejects.toThrow(OllamaError);
    expect(mockHttpRequest).toHaveBeenCalledTimes(1);
  });

  it('maps done_reason "length" to finishReason: max_tokens', async () => {
    mockOllamaHttp(200, [JSON.stringify({ message: { content: "cut off" }, done_reason: "length" })]);
    const provider = new OllamaProvider({ model: "llama3.2" });
    const result = await provider.call(baseParams);
    expect(result.finishReason).toBe("max_tokens");
  });

  it("maps an unrecognized/absent done_reason to finishReason: other (never refusal — Ollama has no such signal)", async () => {
    mockOllamaHttp(200, [JSON.stringify({ message: { content: "..." } })]);
    const provider = new OllamaProvider({ model: "llama3.2" });
    const result = await provider.call(baseParams);
    expect(result.finishReason).toBe("other");
  });

  it("defaults OLLAMA_BASE_URL to http://localhost:11434 when unset", async () => {
    mockOllamaHttp(200, [JSON.stringify({ message: { content: "x" }, done_reason: "stop" })]);
    const provider = new OllamaProvider({ model: "llama3.2" });
    await provider.call(baseParams);
    expect(capturedRequests[0]!.url.toString()).toBe("http://localhost:11434/api/chat");
  });

  it("throws OllamaError with the real status/body on a non-ok response", async () => {
    mockOllamaHttp(404, ['model "llama3.2" not found, try pulling it first']);

    const provider = new OllamaProvider({ model: "llama3.2" });
    await expect(provider.call(baseParams)).rejects.toThrow(OllamaError);
    await expect(provider.call(baseParams)).rejects.toThrow(/404/);
  });

  it("times out with a TimeoutError (not hanging forever) when the request never resolves", async () => {
    vi.useFakeTimers();
    // A request whose .end() never invokes the callback at all — the real-world equivalent of a
    // connection that never receives a response, which node:http (deliberately, see the class doc
    // comment) does NOT time out on its own; only the caller's own AbortSignal should.
    mockHttpRequest.mockImplementation(() => {
      const req = new EventEmitter() as EventEmitter & { write: (chunk: string) => void; end: () => void };
      req.write = vi.fn();
      req.end = vi.fn();
      return req;
    });

    const provider = new OllamaProvider({ model: "llama3.2" });
    const resultPromise = provider.call({ ...baseParams, timeoutMs: 30_000 });
    const assertion = expect(resultPromise).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;

    vi.useRealTimers();
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

  it("selects ollama when LLM_PROVIDER=ollama", () => {
    process.env.LLM_PROVIDER = "ollama";
    resetProviderCache();
    expect(getProvider().name).toBe("ollama");
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
