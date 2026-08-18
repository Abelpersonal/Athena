import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(function MockAnthropic() {
    return { messages: { create: mockCreate } };
  }),
}));

const { run, OrchestratorError } = await import("../src/orchestrator/index.js");

function textResponse(text: string, stopReason: string = "end_turn") {
  return {
    content: [{ type: "text", text }],
    stop_reason: stopReason,
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

describe("orchestrator retry logic", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("retries once on an invalid response, then succeeds", async () => {
    mockCreate
      .mockResolvedValueOnce(textResponse("this is not json at all"))
      .mockResolvedValueOnce(
        textResponse(JSON.stringify({ summary: "A short summary.", wordCount: 3 }))
      );

    const result = await run(
      "summarize_text",
      { text: "Some long text to summarize." },
      "test-module"
    );

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.attempts).toBe(2);
    expect(result.data).toEqual({ summary: "A short summary.", wordCount: 3 });
  });

  it("retries on a schema-invalid response (missing field), then succeeds", async () => {
    mockCreate
      .mockResolvedValueOnce(textResponse(JSON.stringify({ summary: "Missing word count" })))
      .mockResolvedValueOnce(
        textResponse(JSON.stringify({ summary: "Now complete.", wordCount: 2 }))
      );

    const result = await run(
      "summarize_text",
      { text: "Some text." },
      "test-module"
    );

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual({ summary: "Now complete.", wordCount: 2 });

    // The retry prompt sent on the second call should carry a correction note.
    const secondCallArgs = mockCreate.mock.calls[1]?.[0];
    const secondUserMessage = secondCallArgs.messages[0].content as string;
    expect(secondUserMessage).toContain("CORRECTION NEEDED");
  });

  it("succeeds on the first attempt when the response is valid immediately", async () => {
    mockCreate.mockResolvedValueOnce(
      textResponse(JSON.stringify({ keyPoints: ["Point one", "Point two"] }))
    );

    const result = await run(
      "extract_key_points",
      { text: "Some text with two points." },
      "test-module"
    );

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.attempts).toBe(1);
    expect(result.data).toEqual({ keyPoints: ["Point one", "Point two"] });
  });

  it("throws OrchestratorError after exhausting the configured retries", async () => {
    mockCreate.mockResolvedValue(textResponse("still not valid json"));

    await expect(
      run("summarize_text", { text: "Some text." }, "test-module", { maxRetries: 1 })
    ).rejects.toThrow(OrchestratorError);

    // 1 initial attempt + 1 retry = 2 calls total.
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("does not retry on a model refusal", async () => {
    mockCreate.mockResolvedValueOnce(textResponse("", "refusal"));

    await expect(
      run("summarize_text", { text: "Some text." }, "test-module")
    ).rejects.toThrow(OrchestratorError);

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("throws a descriptive error for an unregistered task type", async () => {
    await expect(
      run("not_a_real_task_type", {}, "test-module")
    ).rejects.toThrow(/No prompt template registered/);

    expect(mockCreate).not.toHaveBeenCalled();
  });
});
