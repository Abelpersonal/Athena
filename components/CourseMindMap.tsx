"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ReactFlow, Background, Controls, type Node, type Edge, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { computeMindMapLayout, nodeCountByModule, type MindMapLayoutModule } from "../src/mindMap/layout.js";
import type { MasteryStatus } from "../src/shared/mastery.js";
import type { MindMapGraph } from "../src/db/schema.js";

const STATUS_BORDER: Record<MasteryStatus, string> = {
  not_started: "var(--color-border)",
  in_progress: "var(--color-warn)",
  mastered: "var(--color-accent)",
};

interface ConceptNodeData extends Record<string, unknown> {
  conceptLabel: string;
  status: MasteryStatus;
  isFresh: boolean;
}

function ConceptNode({ data }: NodeProps & { data: ConceptNodeData }) {
  return (
    <div
      className="rounded-lg border-2 px-3 py-2 text-xs bg-[var(--color-surface-raised)] text-[var(--color-text)] cursor-pointer"
      style={{ borderColor: STATUS_BORDER[data.status], minWidth: 200 }}
    >
      {data.isFresh && (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-warn)] mr-1.5" title="Recently updated" />
      )}
      {data.conceptLabel}
    </div>
  );
}

const nodeTypes = { concept: ConceptNode };

/**
 * The Course view's mind map panel (Phase 8, PRD §5.5) — static per-course overview graph,
 * generated once at course creation (src/mindMap/index.ts). All the actual layout/state logic
 * (grid positioning, mastery-status coloring, freshness flagging, the "both endpoints visible"
 * edge rule) lives in src/mindMap/layout.ts's `computeMindMapLayout` — pure, unit-tested directly
 * (tests/mindMapLayout.test.ts) — this component just renders that output through React Flow.
 *
 * Modules start COLLAPSED (PRD §5.5's "expandable/collapsible," this phase's chosen default).
 */
export function CourseMindMap({
  graph,
  modules,
  updatedLessonIds,
}: {
  graph: MindMapGraph;
  modules: MindMapLayoutModule[];
  updatedLessonIds: string[];
}) {
  const router = useRouter();
  const [expandedModuleIds, setExpandedModuleIds] = useState<Set<string>>(new Set());

  const sortedModules = useMemo(() => [...modules].sort((a, b) => a.order - b.order), [modules]);
  const counts = useMemo(() => nodeCountByModule(graph, modules), [graph, modules]);
  const layout = useMemo(
    () => computeMindMapLayout(graph, modules, expandedModuleIds, updatedLessonIds),
    [graph, modules, expandedModuleIds, updatedLessonIds]
  );

  const flowNodes: Node[] = layout.nodes.map((n) => ({
    id: n.id,
    type: "concept",
    position: { x: n.x, y: n.y },
    data: { conceptLabel: n.conceptLabel, status: n.status, isFresh: n.isFresh },
  }));
  const flowEdges: Edge[] = layout.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    animated: e.type === "prerequisite",
    style: { stroke: e.type === "prerequisite" ? "var(--color-accent)" : "var(--color-text-faint)" },
  }));

  function toggleModule(moduleId: string) {
    setExpandedModuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {sortedModules.map((m) => {
          const count = counts.get(m.id) ?? 0;
          if (count === 0) return null;
          const expanded = expandedModuleIds.has(m.id);
          return (
            <button
              key={m.id}
              onClick={() => toggleModule(m.id)}
              className={`text-xs px-2.5 py-1 rounded-full border ${
                expanded ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-[var(--color-border)] text-[var(--color-text-muted)]"
              }`}
            >
              {expanded ? "▾" : "▸"} {m.title} ({count})
            </button>
          );
        })}
      </div>

      {flowNodes.length > 0 ? (
        <div style={{ height: 360 }} className="rounded-lg border border-[var(--color-border)]">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            onNodeClick={(_e, node) => router.push(`/lessons/${node.id}`)}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      ) : (
        <p className="text-sm text-[var(--color-text-faint)]">Expand a module above to see its concept map.</p>
      )}
    </div>
  );
}
