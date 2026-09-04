import { describe, it, expect } from "vitest";
import { computeMindMapLayout, nodeCountByModule, type MindMapLayoutModule } from "../src/mindMap/layout.js";
import type { MindMapGraph } from "../src/db/schema.js";

const modules: MindMapLayoutModule[] = [
  {
    id: "mod_1",
    title: "Foundations",
    order: 0,
    lessons: [
      { id: "lsn_1", knowledgeScore: null }, // not_started
      { id: "lsn_2", knowledgeScore: 0.5 }, // in_progress
    ],
  },
  {
    id: "mod_2",
    title: "Applications",
    order: 1,
    lessons: [
      { id: "lsn_3", knowledgeScore: 0.9 }, // mastered (>= 0.75)
    ],
  },
];

const graph: MindMapGraph = {
  nodes: [
    { id: "lsn_1", conceptLabel: "Concept A" },
    { id: "lsn_2", conceptLabel: "Concept B" },
    { id: "lsn_3", conceptLabel: "Concept C" },
  ],
  edges: [
    { source: "lsn_1", target: "lsn_2", type: "prerequisite" },
    { source: "lsn_2", target: "lsn_3", type: "cross_link" },
  ],
};

describe("computeMindMapLayout", () => {
  it("shows no nodes when no module is expanded (collapsed-by-default)", () => {
    const result = computeMindMapLayout(graph, modules, new Set(), []);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("shows only the expanded module's nodes, correctly positioned in its own column/rows", () => {
    const result = computeMindMapLayout(graph, modules, new Set(["mod_1"]), [], { columnWidth: 200, rowHeight: 100 });
    expect(result.nodes.map((n) => n.id).sort()).toEqual(["lsn_1", "lsn_2"]);
    const a = result.nodes.find((n) => n.id === "lsn_1")!;
    const b = result.nodes.find((n) => n.id === "lsn_2")!;
    expect(a.x).toBe(0); // the only (first) expanded module -> column 0
    expect(a.y).toBe(0); // first lesson in the module -> row 0
    expect(b.x).toBe(0); // same module, same column
    expect(b.y).toBe(100); // second lesson -> row 1
  });

  it("assigns a real column per EXPANDED module, in module.order sequence, skipping collapsed ones", () => {
    const result = computeMindMapLayout(graph, modules, new Set(["mod_1", "mod_2"]), [], { columnWidth: 200 });
    const a = result.nodes.find((n) => n.id === "lsn_1")!;
    const c = result.nodes.find((n) => n.id === "lsn_3")!;
    expect(a.x).toBe(0); // mod_1 (order 0) -> column 0
    expect(c.x).toBe(200); // mod_2 (order 1) -> column 1
  });

  it("computes real mastery status per node, reusing the shared threshold (mastered >= 0.75)", () => {
    const result = computeMindMapLayout(graph, modules, new Set(["mod_1", "mod_2"]), []);
    expect(result.nodes.find((n) => n.id === "lsn_1")!.status).toBe("not_started");
    expect(result.nodes.find((n) => n.id === "lsn_2")!.status).toBe("in_progress");
    expect(result.nodes.find((n) => n.id === "lsn_3")!.status).toBe("mastered");
  });

  it("flags only lessons with a real Phase 6 update as fresh", () => {
    const result = computeMindMapLayout(graph, modules, new Set(["mod_1", "mod_2"]), ["lsn_2"]);
    expect(result.nodes.find((n) => n.id === "lsn_1")!.isFresh).toBe(false);
    expect(result.nodes.find((n) => n.id === "lsn_2")!.isFresh).toBe(true);
    expect(result.nodes.find((n) => n.id === "lsn_3")!.isFresh).toBe(false);
  });

  it("never renders a dangling edge — an edge appears ONLY when both endpoints are visible", () => {
    // Only mod_1 expanded: lsn_1/lsn_2 visible, lsn_3 is not. lsn_1->lsn_2 has both endpoints
    // visible; lsn_2->lsn_3 does NOT (lsn_3's module is collapsed) and must be excluded.
    const onlyMod1 = computeMindMapLayout(graph, modules, new Set(["mod_1"]), []);
    expect(onlyMod1.edges).toHaveLength(1);
    expect(onlyMod1.edges[0]).toMatchObject({ source: "lsn_1", target: "lsn_2" });

    const bothModules = computeMindMapLayout(graph, modules, new Set(["mod_1", "mod_2"]), []);
    expect(bothModules.edges).toHaveLength(2);
  });

  it("preserves each edge's real type (prerequisite vs cross_link)", () => {
    const result = computeMindMapLayout(graph, modules, new Set(["mod_1", "mod_2"]), []);
    expect(result.edges.find((e) => e.source === "lsn_1")!.type).toBe("prerequisite");
    expect(result.edges.find((e) => e.source === "lsn_2")!.type).toBe("cross_link");
  });

  it("excludes a graph node whose lesson isn't in any provided module (defensive — should not happen given real DB consistency)", () => {
    const graphWithOrphan: MindMapGraph = { nodes: [...graph.nodes, { id: "lsn_orphan", conceptLabel: "Orphan" }], edges: [] };
    const result = computeMindMapLayout(graphWithOrphan, modules, new Set(["mod_1", "mod_2"]), []);
    expect(result.nodes.map((n) => n.id)).not.toContain("lsn_orphan");
  });
});

describe("nodeCountByModule", () => {
  it("counts how many graph nodes belong to each module — what the collapsed chips display", () => {
    const counts = nodeCountByModule(graph, modules);
    expect(counts.get("mod_1")).toBe(2);
    expect(counts.get("mod_2")).toBe(1);
  });

  it("a module with zero graph nodes is simply absent from the map (not zero) — the chip is hidden, not shown at 0", () => {
    const modulesWithEmpty: MindMapLayoutModule[] = [...modules, { id: "mod_3", title: "Empty", order: 2, lessons: [{ id: "lsn_4", knowledgeScore: null }] }];
    const counts = nodeCountByModule(graph, modulesWithEmpty);
    expect(counts.has("mod_3")).toBe(false);
  });
});
