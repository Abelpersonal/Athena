import { describe, it, expect } from "vitest";
import { getRecheckIntervalDays, DEFAULT_RECHECK_INTERVAL_DAYS } from "../src/shared/recheckInterval.js";

describe("getRecheckIntervalDays (Phase 6, shared by pathPlanner/overlap.ts and knowledgeUpdate/index.ts)", () => {
  it("resolved defaults per the PRD: fast=14, medium=60, slow=180", () => {
    expect(getRecheckIntervalDays("fast")).toBe(14);
    expect(getRecheckIntervalDays("medium")).toBe(60);
    expect(getRecheckIntervalDays("slow")).toBe(180);
  });

  it("defaults 'mixed' to medium's value (unspecified by the PRD)", () => {
    expect(getRecheckIntervalDays("mixed")).toBe(60);
  });

  it("DEFAULT_RECHECK_INTERVAL_DAYS exposes the same values as a plain map", () => {
    expect(DEFAULT_RECHECK_INTERVAL_DAYS).toEqual({ fast: 14, medium: 60, slow: 180, mixed: 60 });
  });

  it("respects an injected override map over the module defaults", () => {
    expect(getRecheckIntervalDays("fast", { fast: 7 })).toBe(7);
    expect(getRecheckIntervalDays("medium", { fast: 7 })).toBe(60); // falls back to the default for unset tiers
  });
});
