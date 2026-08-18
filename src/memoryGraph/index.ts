/**
 * Stub for Phase 3.5 (Graphiti/Neo4j isn't wired in yet). The Course
 * Builder's spec calls for writing topic + prerequisite relationships to
 * the Memory Graph right after persistence — this is that seam, kept as an
 * explicit no-op rather than silently missing, so Phase 3.5 has a single
 * known place to plug the real client in.
 */
export async function writeTopic(courseId: string, prerequisites: string[]): Promise<void> {
  console.log(
    `[memory-graph] TODO: Phase 3.5 — writeTopic(courseId=${courseId}, prerequisites=[${prerequisites.join(", ")}]) not yet implemented (Graphiti/Neo4j not wired in).`
  );
}
