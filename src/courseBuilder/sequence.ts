import type { SequenceModulesOutput } from "../orchestrator/templates/sequenceModules.js";

export class CourseBuilderError extends Error {}

export type SequencedModule = SequenceModulesOutput["modules"][number];

/**
 * Turns sequence_modules' raw dependency graph (prerequisiteOfTempIds edges)
 * into an actual linear module order via Kahn's algorithm — the model is
 * not trusted to hand back a self-consistent total order directly (same
 * philosophy as depth_audit_score's overallPass being computed in code, not
 * read off the model's own verdict). Ties are broken by the model's
 * original array position, so the result is deterministic for a given
 * response. Throws CourseBuilderError if the edges describe a genuine cycle
 * (a real structural problem worth surfacing, not silently working around).
 */
export function topoSortModules(modules: SequencedModule[]): SequencedModule[] {
  const originalIndex = new Map(modules.map((m, i) => [m.tempId, i]));
  const byTempId = new Map(modules.map((m) => [m.tempId, m]));

  // Forward edges (prerequisiteOfTempIds already point "this -> depends on it"), self-edges and
  // dangling references dropped rather than trusted verbatim from the model.
  const forwardEdges = new Map<string, string[]>();
  const inDegree = new Map<string, number>(modules.map((m) => [m.tempId, 0]));
  for (const m of modules) {
    const edges = m.prerequisiteOfTempIds.filter((to) => to !== m.tempId && byTempId.has(to));
    forwardEdges.set(m.tempId, edges);
  }
  for (const edges of forwardEdges.values()) {
    for (const to of edges) {
      inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
    }
  }

  const queue = modules.filter((m) => inDegree.get(m.tempId) === 0).map((m) => m.tempId);
  const order: string[] = [];

  while (queue.length > 0) {
    queue.sort((a, b) => originalIndex.get(a)! - originalIndex.get(b)!);
    const next = queue.shift()!;
    order.push(next);
    for (const to of forwardEdges.get(next) ?? []) {
      const remaining = (inDegree.get(to) ?? 0) - 1;
      inDegree.set(to, remaining);
      if (remaining === 0) queue.push(to);
    }
  }

  if (order.length !== modules.length) {
    const stuckIds = modules.map((m) => m.tempId).filter((id) => !order.includes(id));
    const stuckTitles = stuckIds
      .map((id) => byTempId.get(id)?.subtopicIds.join("/") ?? id)
      .join(", ");
    throw new CourseBuilderError(
      `sequence_modules produced a cyclic prerequisite graph — these modules can't be linearly ordered: ${stuckTitles}.`
    );
  }

  return order.map((id) => byTempId.get(id)!);
}
