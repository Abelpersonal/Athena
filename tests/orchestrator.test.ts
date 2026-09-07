import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCall = vi.fn();

// Mock at the provider-selection seam, not the raw vendor SDK — the
// Orchestrator's retry/validation logic is vendor-agnostic (it only talks to
// LLMProvider), so this is the right boundary to test against regardless of
// which provider LLM_PROVIDER selects for real runs.
vi.mock("../src/orchestrator/providers/index.js", () => ({
  getProvider: () => ({ name: "mock", defaultModel: "mock-model", call: mockCall }),
}));

const { run, OrchestratorError, OrchestratorBudgetExceededError, getSessionCost, resetSessionCost } = await import(
  "../src/orchestrator/index.js"
);

function llmResult(text: string, finishReason: "end_turn" | "max_tokens" | "refusal" | "other" = "end_turn") {
  return { text, inputTokens: 10, outputTokens: 20, finishReason };
}

describe("orchestrator retry logic", () => {
  beforeEach(() => {
    mockCall.mockReset();
    resetSessionCost();
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

describe("orchestrator session cost budget cap (Timeouts + Hard Cost Cap, Deliverable 2)", () => {
  const originalBudget = process.env.ORCHESTRATOR_SESSION_BUDGET_USD;

  // A real, priced model (see src/orchestrator/pricing.ts) — the mocked provider's own
  // "mock-model" has no pricing entry and would cost $0, which can't exercise a dollar cap.
  const PRICED_MODEL = "gemini-3.7-flash";
  // Real gemini-3.7-flash pricing ($0.75/$3.75 per 1M input/output tokens) with a deliberately
  // huge token count so one call's real estimated cost ($4.50) is large enough to cross a small
  // test budget cleanly, without the test depending on exact floating-point cost arithmetic.
  const expensiveResult = () => ({
    text: JSON.stringify({ summary: "A short summary.", wordCount: 3 }),
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    finishReason: "end_turn" as const,
  });
  const runPriced = (text: string) =>
    run("summarize_text", { text }, "test-module", { model: PRICED_MODEL });

  beforeEach(() => {
    mockCall.mockReset();
    resetSessionCost();
  });

  afterEach(() => {
    resetSessionCost();
    if (originalBudget === undefined) delete process.env.ORCHESTRATOR_SESSION_BUDGET_USD;
    else process.env.ORCHESTRATOR_SESSION_BUDGET_USD = originalBudget;
  });

  it("leaving ORCHESTRATOR_SESSION_BUDGET_USD unset preserves today's unlimited behavior exactly — no call is ever blocked", async () => {
    delete process.env.ORCHESTRATOR_SESSION_BUDGET_USD;
    mockCall.mockResolvedValue(expensiveResult());

    for (let i = 0; i < 5; i++) {
      await runPriced("Some long text to summarize.");
    }

    expect(mockCall).toHaveBeenCalledTimes(5);
    expect(getSessionCost()).toBeCloseTo(4.5 * 5, 5);
  });

  it("refuses a call BEFORE making it once the running total reaches the configured cap", async () => {
    process.env.ORCHESTRATOR_SESSION_BUDGET_USD = "4"; // one $4.50 call already exceeds this
    mockCall.mockResolvedValue(expensiveResult());

    // First call: budget check passes (running total is still $0 < $4 cap) — proceeds normally.
    const first = await runPriced("First call.");
    expect(first.data).toEqual({ summary: "A short summary.", wordCount: 3 });
    expect(mockCall).toHaveBeenCalledTimes(1);
    expect(getSessionCost()).toBeCloseTo(4.5, 5);

    // Second call: running total ($4.50) now exceeds the $4 cap — refused BEFORE the call is made.
    await expect(runPriced("Second call.")).rejects.toBeInstanceOf(OrchestratorBudgetExceededError);
    expect(mockCall).toHaveBeenCalledTimes(1); // still 1 — the second call never actually ran
  });

  it("OrchestratorBudgetExceededError names the current total and the configured cap", async () => {
    process.env.ORCHESTRATOR_SESSION_BUDGET_USD = "4";
    mockCall.mockResolvedValue(expensiveResult());
    await runPriced("First call.");

    const error: InstanceType<typeof OrchestratorBudgetExceededError> = await runPriced("Second call.").catch(
      (e) => e
    );

    expect(error).toBeInstanceOf(OrchestratorBudgetExceededError);
    expect(error.currentTotalUsd).toBeCloseTo(4.5, 5);
    expect(error.budgetUsd).toBe(4);
    expect(error.message).toContain("4.5");
    expect(error.message).toContain("4.0000");
  });

  it("is an OrchestratorError-family error (a caller catching OrchestratorError broadly still catches this)", async () => {
    process.env.ORCHESTRATOR_SESSION_BUDGET_USD = "4";
    mockCall.mockResolvedValue(expensiveResult());
    await runPriced("First call.");

    await expect(runPriced("Second call.")).rejects.toBeInstanceOf(OrchestratorError);
  });
});
