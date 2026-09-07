import { describe, it, expect } from "vitest";
import { computeCrossDomainOrder, partitionDomainsIntoPhases, PathPlannerError } from "../src/pathPlanner/ordering.js";
import type { OrderableTopic } from "../src/pathPlanner/ordering.js";

function topic(tempId: string, dependsOnTempIds: string[] = []): OrderableTopic {
  return { tempId, dependsOnTempIds };
}

describe("computeCrossDomainOrder", () => {
  it("places a topic in one domain that depends on a topic in a different domain at a strictly later tier", () => {
    // math-1 (Math domain) has no deps; prog-1 (Programming domain) depends on math-1 — a genuine
    // cross-domain edge, the "actually hard part" this function exists to handle.
    const ordered = computeCrossDomainOrder([topic("math-1"), topic("prog-1", ["math-1"])]);
    const byId = new Map(ordered.map((o) => [o.tempId, o]));
    expect(byId.get("math-1")!.order).toBe(0);
    expect(byId.get("prog-1")!.order).toBe(1);
    expect(byId.get("prog-1")!.order).toBeGreaterThan(byId.get("math-1")!.order);
  });

  it("groups topics with no dependency between them into the same tier and parallelGroup, even across domains", () => {
    const ordered = computeCrossDomainOrder([topic("math-1"), topic("prog-1"), topic("fin-1")]);
    expect(new Set(ordered.map((o) => o.order))).toEqual(new Set([0]));
    expect(new Set(ordered.map((o) => o.parallelGroup))).toEqual(new Set(["tier_0"]));
  });

  it("assigns a topic's tier as 1 + the max tier of its dependencies, across a longer chain", () => {
    // c depends on b depends on a -> tiers 0, 1, 2
    const ordered = computeCrossDomainOrder([topic("a"), topic("b", ["a"]), topic("c", ["b"])]);
    const byId = new Map(ordered.map((o) => [o.tempId, o]));
    expect(byId.get("a")!.order).toBe(0);
    expect(byId.get("b")!.order).toBe(1);
    expect(byId.get("c")!.order).toBe(2);
  });

  it("handles a topic with multiple dependencies at different tiers by using the max", () => {
    // d depends on both a (tier 0) and c (tier 1, since c depends on b depends on a) -> d lands at tier 2
    const ordered = computeCrossDomainOrder([
      topic("a"),
      topic("b", ["a"]),
      topic("c", ["b"]),
      topic("d", ["a", "c"]),
    ]);
    const byId = new Map(ordered.map((o) => [o.tempId, o]));
    expect(byId.get("d")!.order).toBe(3); // a=0, b=1, c=2, d=3
  });

  it("throws PathPlannerError on a genuine cycle", () => {
    expect(() => computeCrossDomainOrder([topic("a", ["b"]), topic("b", ["a"])])).toThrow(PathPlannerError);
  });

  it("ignores a self-referencing edge rather than treating it as a cycle", () => {
    const ordered = computeCrossDomainOrder([topic("a", ["a"])]);
    expect(ordered.map((o) => o.tempId)).toEqual(["a"]);
    expect(ordered[0]!.order).toBe(0);
  });

  it("ignores an edge pointing at an unknown tempId rather than crashing", () => {
    const ordered = computeCrossDomainOrder([topic("a", ["does-not-exist"])]);
    expect(ordered[0]!.order).toBe(0);
  });
});

describe("partitionDomainsIntoPhases (Graceful Over-Large-Goal Handling)", () => {
  it("returns an empty array for no domains", () => {
    expect(partitionDomainsIntoPhases([], [])).toEqual([]);
  });

  it("returns exactly one phase (no split at all) when there's only one domain", () => {
    const phases = partitionDomainsIntoPhases(["d1"], [{ domainTempId: "d1", order: 0 }]);
    expect(phases).toEqual([["d1"]]);
  });

  it("splits domains into contiguous, tier-ordered phases — never mixing a domain across phases", () => {
    // d3's topics are earliest (tier 0), d1's are middle (tier 1), d2's are latest (tier 2) —
    // phase order must follow real tier order, not input array order.
    const phases = partitionDomainsIntoPhases(
      ["d1", "d2", "d3"],
      [
        { domainTempId: "d1", order: 1 },
        { domainTempId: "d2", order: 2 },
        { domainTempId: "d3", order: 0 },
      ],
      3
    );
    expect(phases).toEqual([["d3"], ["d1"], ["d2"]]);
    // Every domain appears in exactly one phase — never split, never duplicated.
    expect(phases.flat().sort()).toEqual(["d1", "d2", "d3"]);
  });

  it("caps at maxPhases, grouping multiple domains per phase in tier order when there are more domains than phases", () => {
    const domainTempIds = ["d1", "d2", "d3", "d4", "d5"];
    const topicRefs = domainTempIds.map((id, i) => ({ domainTempId: id, order: i }));
    const phases = partitionDomainsIntoPhases(domainTempIds, topicRefs, 3);

    expect(phases).toHaveLength(3);
    expect(phases.flat().sort()).toEqual(domainTempIds); // every domain placed exactly once
    // Sizes are as even as possible: 5 domains / 3 phases -> [2, 2, 1].
    expect(phases.map((p) => p.length).sort((a, b) => b - a)).toEqual([2, 2, 1]);
  });

  it("a domain with no topics at all sorts as if its earliest tier were 0, rather than crashing", () => {
    const phases = partitionDomainsIntoPhases(["d1", "d2"], [{ domainTempId: "d1", order: 5 }], 2);
    expect(phases.flat().sort()).toEqual(["d1", "d2"]);
  });
});
