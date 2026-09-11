import { describe, it, expect, vi, afterEach } from "vitest";
import { estimateCostUsd } from "../src/orchestrator/pricing.js";

describe("estimateCostUsd", () => {
  afterEach(() => vi.restoreAllMocks());

  it("computes real cost for a known hosted model", () => {
    const cost = estimateCostUsd("gemini-3.7-flash", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.75 + 3.75);
  });

  it("returns $0 silently (no warning) for the ollama provider, regardless of model name", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cost = estimateCostUsd("literally-any-local-model-name", 500_000, 500_000, "ollama");
    expect(cost).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("still warns for a genuinely unrecognized hosted-model name (not ollama) — the gap this distinguishes from", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cost = estimateCostUsd("some-future-model-not-in-the-table", 100, 100);
    expect(cost).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("No pricing data"));
  });
});
