import type { MindMapGraph } from "../db/schema.js";
import { masteryStatusFor, type MasteryStatus } from "../shared/mastery.js";

/**
 * Phase 8's mind map layout — the pure computation behind `components/CourseMindMap.tsx`,
 * deliberately extracted into a plain `.ts` file (no JSX, no CSS import) so it's testable under
 * this project's existing vitest setup without adding component-testing infrastructure. The
 * component itself just maps this output onto `@xyflow/react`'s `Node`/`Edge` shapes.
 *
 * A grid, not an auto-layout library: column = module (by real, already-topologically-sorted
 * `modules.order`), row = that module's lessons that have a graph node — deliberate, see README.
 * Node state is computed HERE from the real `knowledgeScore` each lesson carries, reusing
 * `masteryStatusFor` (src/shared/mastery.ts) unchanged — the SAME thresholds `MasteryBadge`
 * colors the plain list by. An edge is only ever included once BOTH its endpoints are visible —
 * collapsing a module can never leave a dangling half-edge on screen.
 */

export interface MindMapLayoutModule {
  id: string;
  title: string;
  order: number;
  lessons: Array<{ id: string; knowledgeScore: number | null }>;
}

export interface MindMapLayoutNode {
  id: string;
  conceptLabel: string;
  x: number;
  y: number;
  status: MasteryStatus;
  isFresh: boolean;
}

export interface MindMapLayoutEdge {
  id: string;
  source: string;
  target: string;
  type: "prerequisite" | "cross_link";
}

export interface MindMapLayoutResult {
  nodes: MindMapLayoutNode[];
  edges: MindMapLayoutEdge[];
}

export interface ComputeMindMapLayoutOptions {
  columnWidth?: number;
  rowHeight?: number;
}

const DEFAULT_COLUMN_WIDTH = 240;
const DEFAULT_ROW_HEIGHT = 90;

export function computeMindMapLayout(
  graph: MindMapGraph,
  modules: MindMapLayoutModule[],
  expandedModuleIds: ReadonlySet<string>,
  updatedLessonIds: readonly string[],
  options: ComputeMindMapLayoutOptions = {}
): MindMapLayoutResult {
  const columnWidth = options.columnWidth ?? DEFAULT_COLUMN_WIDTH;
  const rowHeight = options.rowHeight ?? DEFAULT_ROW_HEIGHT;

  const moduleByLessonId = new Map<string, MindMapLayoutModule>();
  const knowledgeScoreByLessonId = new Map<string, number | null>();
  for (const m of modules) {
    for (const l of m.lessons) {
      moduleByLessonId.set(l.id, m);
      knowledgeScoreByLessonId.set(l.id, l.knowledgeScore);
    }
  }
  const updatedSet = new Set(updatedLessonIds);

  const expandedModulesInOrder = [...modules].sort((a, b) => a.order - b.order).filter((m) => expandedModuleIds.has(m.id));
  const columnIndexByModuleId = new Map(expandedModulesInOrder.map((m, i) => [m.id, i]));

  const visibleGraphNodes = graph.nodes.filter((n) => {
    const mod = moduleByLessonId.get(n.id);
    return mod !== undefined && expandedModuleIds.has(mod.id);
  });

  const rowCounters = new Map<string, number>();
  const nodes: MindMapLayoutNode[] = visibleGraphNodes.map((n) => {
    const mod = moduleByLessonId.get(n.id)!;
    const col = columnIndexByModuleId.get(mod.id)!;
    const row = rowCounters.get(mod.id) ?? 0;
    rowCounters.set(mod.id, row + 1);

    return {
      id: n.id,
      conceptLabel: n.conceptLabel,
      x: col * columnWidth,
      y: row * rowHeight,
      status: masteryStatusFor(knowledgeScoreByLessonId.get(n.id) ?? null),
      isFresh: updatedSet.has(n.id),
    };
  });

  const visibleIds = new Set(visibleGraphNodes.map((n) => n.id));
  const edges: MindMapLayoutEdge[] = graph.edges
    .filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
    .map((e) => ({ id: `${e.source}->${e.target}`, source: e.source, target: e.target, type: e.type }));

  return { nodes, edges };
}

/** How many graph nodes belong to each module — what the collapsed module chips display, e.g. "Foundations (3)". */
export function nodeCountByModule(graph: MindMapGraph, modules: MindMapLayoutModule[]): Map<string, number> {
  const moduleByLessonId = new Map<string, MindMapLayoutModule>();
  for (const m of modules) for (const l of m.lessons) moduleByLessonId.set(l.id, m);

  const counts = new Map<string, number>();
  for (const n of graph.nodes) {
    const mod = moduleByLessonId.get(n.id);
    if (mod) counts.set(mod.id, (counts.get(mod.id) ?? 0) + 1);
  }
  return counts;
}
