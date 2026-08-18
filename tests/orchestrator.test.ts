import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCall = vi.fn();

// Mock at the provider-selection seam, not the raw vendor SDK — the
// Orchestrator's retry/validation logic is vendor-agnostic (it only talks to
// LLMProvider), so this is the right boundary to test against regardless of
// which provider LLM_PROVIDER selects for real runs.
vi.mock("../src/orchestrator/providers/index.js", () => ({
  getProvider: () => ({ name: "mock", defaultModel: "mock-model", call: mockCall }),
}));

const { run, OrchestratorError } = await import("../src/orchestrator/index.js");

function llmResult(text: string, finishReason: "end_turn" | "max_tokens" | "refusal" | "other" = "end_turn") {
  return { text, inputTokens: 10, outputTokens: 20, finishReason };
}

describe("orchestrator retry logic", () => {
  beforeEach(() => {
    mockCall.mockReset();
  });

  it("retries once on an invalid response, then succeeds", async () => {
    mockCall
      .mockResolvedValueOnce(llmResult("this is not json at all"))
      .mockResolvedValueOnce(
        llmResult(JSON.stringify({ summary: "A short summary.", wordCount: 3 }))
      );

    const result = await run(
      "summarize_text",
      { text: "Some long text to summarize." },
      "test-module"
    );

    expect(mockCall).toHaveBeenCalledTimes(2);
    expect(result.attempts).toBe(2);
    expect(result.data).toEqual({ summary: "A short summary.", wordCount: 3 });
  });

  it("retries on a schema-invalid response (missing field), then succeeds", async () => {
    mockCall
      .mockResolvedValueOnce(llmResult(JSON.stringify({ summary: "Missing word count" })))
      .mockResolvedValueOnce(
        llmResult(JSON.stringify({ summary: "Now complete.", wordCount: 2 }))
      );

    const result = await run(
      "summarize_text",
      { text: "Some text." },
      "test-module"
    );

    expect(mockCall).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual({ summary: "Now complete.", wordCount: 2 });

    // The retry prompt sent on the second call should carry a correction note.
    const secondCallArgs = mockCall.mock.calls[1]?.[0];
    expect(secondCallArgs.userPrompt).toContain("CORRECTION NEEDED");
  });

  it("succeeds on the first attempt when the response is valid immediately", async () => {
    mockCall.mockResolvedValueOnce(
      llmResult(JSON.stringify({ keyPoints: ["Point one", "Point two"] }))
    );

    const result = await run(
      "extract_key_points",
      { text: "Some text with two points." },
      "test-module"
    );

    expect(mockCall).toHaveBeenCalledTimes(1);
    expect(result.attempts).toBe(1);
    expect(result.data).toEqual({ keyPoints: ["Point one", "Point two"] });
  });

  it("throws OrchestratorError after exhausting the configured retries", async () => {
    mockCall.mockResolvedValue(llmResult("still not valid json"));

    await expect(
      run("summarize_text", { text: "Some text." }, "test-module", { maxRetries: 1 })
    ).rejects.toThrow(OrchestratorError);

    // 1 initial attempt + 1 retry = 2 calls total.
    expect(mockCall).toHaveBeenCalledTimes(2);
  });

  it("does not retry on a model refusal", async () => {
    mockCall.mockResolvedValueOnce(llmResult("", "refusal"));

    await expect(
      run("summarize_text", { text: "Some text." }, "test-module")
    ).rejects.toThrow(OrchestratorError);

    expect(mockCall).toHaveBeenCalledTimes(1);
  });

  it("throws a descriptive error for an unregistered task type", async () => {
    await expect(
      run("not_a_real_task_type", {}, "test-module")
    ).rejects.toThrow(/No prompt template registered/);

    expect(mockCall).not.toHaveBeenCalled();
  });
});
