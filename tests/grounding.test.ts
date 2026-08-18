import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCitationValidator } from "../src/research/grounding.js";
import type { SynthesizeSubtopicOutput } from "../src/orchestrator/templates/synthesizeSubtopic.js";

const mockCall = vi.fn();

// Mock at the provider-selection seam (see tests/orchestrator.test.ts) — the
// grounding enforcement lives in the Orchestrator's retry loop, which is
// vendor-agnostic, so this test proves it holds regardless of LLM_PROVIDER.
vi.mock("../src/orchestrator/providers/index.js", () => ({
  getProvider: () => ({ name: "mock", defaultModel: "mock-model", call: mockCall }),
}));

const { run, OrchestratorError } = await import("../src/orchestrator/index.js");

function llmResult(text: string) {
  return { text, inputTokens: 10, outputTokens: 20, finishReason: "end_turn" as const };
}

describe("createCitationValidator (pure)", () => {
  it("succeeds when every citation is in the valid set", () => {
    const validate = createCitationValidator(new Set(["a", "b"]), (d) => (d as { ids: string[] }).ids);
    expect(validate({ ids: ["a", "b"] })).toEqual({ success: true });
  });

  it("fails and names the offending id(s) when a citation is outside the valid set", () => {
    const validate = createCitationValidator(new Set(["a", "b"]), (d) => (d as { ids: string[] }).ids);
    const result = validate({ ids: ["a", "z"] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("z");
    }
  });

  it("de-duplicates repeated invalid ids in the error message", () => {
    const validate = createCitationValidator(new Set(["a"]), (d) => (d as { ids: string[] }).ids);
    const result = validate({ ids: ["z", "z", "z"] });
    expect(result.success).toBe(false);
    if (!result.success) {
      // The invalid id should be named once, not three times.
      expect(result.error.match(/\bz\b/g)?.length).toBe(1);
    }
  });
});

describe("grounding enforcement through orchestrator.run (synthesize_subtopic)", () => {
  beforeEach(() => {
    mockCall.mockReset();
  });

  const context = {
    subtopicTitle: "Test Subtopic",
    groundedKeyPoints: [{ point: "A grounded point.", source_id: "src_1" }],
    contentionMaterial: [],
    validSourceIds: ["src_1", "src_2"],
  };
  const validSet = new Set(context.validSourceIds);
  const validateExtra = createCitationValidator(validSet, (d) =>
    (d as { claims: Array<{ source_ids: string[] }> }).claims.flatMap((c) => c.source_ids)
  );

  const fabricatedResponse = JSON.stringify({
    claims: [
      { text: "A claim citing a source that was never provided.", source_ids: ["src_999"], addressesContention: false },
    ],
    contentionNotes: [],
  });

  const groundedResponse = JSON.stringify({
    claims: [{ text: "A claim citing a real source.", source_ids: ["src_1"], addressesContention: false }],
    contentionNotes: [],
  });

  it("retries when the model fabricates a source_id, and succeeds once it cites only real ones", async () => {
    mockCall
      .mockResolvedValueOnce(llmResult(fabricatedResponse))
      .mockResolvedValueOnce(llmResult(groundedResponse));

    const result = await run<SynthesizeSubtopicOutput>("synthesize_subtopic", context, "test-module", {
      validateExtra,
    });

    expect(mockCall).toHaveBeenCalledTimes(2);
    expect(result.attempts).toBe(2);
    expect(result.data.claims[0]!.source_ids).toEqual(["src_1"]);

    // The retry prompt must name the fabricated id so the model knows what to fix.
    const secondCallArgs = mockCall.mock.calls[1]?.[0];
    expect(secondCallArgs.userPrompt).toContain("src_999");
    expect(secondCallArgs.userPrompt).toContain("CORRECTION NEEDED");
  });

  it("never returns a fabricated citation to the caller, even after exhausting every retry", async () => {
    // The model never corrects itself — every attempt fabricates a citation.
    mockCall.mockResolvedValue(llmResult(fabricatedResponse));

    await expect(
      run("synthesize_subtopic", context, "test-module", { maxRetries: 1, validateExtra })
    ).rejects.toThrow(OrchestratorError);

    // 1 initial attempt + 1 retry = 2 calls, and critically: no successful
    // return happened at any point — the grounding violation was caught
    // every single time, not just eventually.
    expect(mockCall).toHaveBeenCalledTimes(2);
  });
});
