export class PathPlannerError extends Error {}

export interface OrderableTopic {
  tempId: string;
  dependsOnTempIds: string[];
}

export interface OrderedTopic {
  tempId: string;
  /** A topological TIER (0, 1, 2, ...) across the WHOLE cross-domain graph — not a strict per-topic unique sequence. */
  order: number;
  /** Every topic at the same tier shares one parallelGroup (see src/db/schema.ts's pathTopics doc comment for why this is its own field). */
  parallelGroup: string;
}

/**
 * Turns determine_cross_domain_dependencies' raw dependency edges into
 * actual scheduling tiers via a levelized topological sort (Kahn's
 * algorithm, generalized to levels instead of one flat order) — the model
 * is not trusted to hand back a self-consistent order/parallelism directly,
 * same philosophy as courseBuilder/sequence.ts's topoSortModules(). Ties
 * within a level are broken by original array position for determinism.
 *
 * This is the "actually hard part" the PRD calls out: dependencies can point
 * across domains (a topic in "Programming" can depend on one in "Math"), so
 * the tiering has to run over the WHOLE topic set at once, not per-domain.
 *
 * Self-referencing and dangling edges are dropped rather than trusted
 * verbatim (mirrors topoSortModules); a genuine cycle throws PathPlannerError
 * rather than silently guessing an order.
 */
export function computeCrossDomainOrder(topics: OrderableTopic[]): OrderedTopic[] {
  const ids = new Set(topics.map((t) => t.tempId));
  const originalIndex = new Map(topics.map((t, i) => [t.tempId, i]));

  const dependsOn = new Map(
    topics.map((t) => [t.tempId, t.dependsOnTempIds.filter((d) => d !== t.tempId && ids.has(d))])
  );
  const dependents = new Map<string, string[]>(topics.map((t) => [t.tempId, []]));
  for (const t of topics) {
    for (const dep of dependsOn.get(t.tempId)!) {
      dependents.get(dep)!.push(t.tempId);
    }
  }

  const remainingDeps = new Map(topics.map((t) => [t.tempId, dependsOn.get(t.tempId)!.length]));
  const order = new Map<string, number>();
  const processed = new Set<string>();

  let currentTier = topics.filter((t) => remainingDeps.get(t.tempId) === 0).map((t) => t.tempId);
  let tier = 0;

  while (currentTier.length > 0) {
    currentTier.sort((a, b) => originalIndex.get(a)! - originalIndex.get(b)!);
    const nextTierCandidates: string[] = [];

    for (const id of currentTier) {
      order.set(id, tier);
      processed.add(id);
    }
    for (const id of currentTier) {
      for (const dependent of dependents.get(id)!) {
        const remaining = remainingDeps.get(dependent)! - 1;
        remainingDeps.set(dependent, remaining);
        if (remaining === 0 && !processed.has(dependent)) nextTierCandidates.push(dependent);
      }
    }

    currentTier = [...new Set(nextTierCandidates)];
    tier += 1;
  }

  if (processed.size !== topics.length) {
    const stuckIds = topics.map((t) => t.tempId).filter((id) => !processed.has(id));
    throw new PathPlannerError(
      `determine_cross_domain_dependencies produced a cyclic dependency graph — these topics can't be linearly tiered: ${stuckIds.join(", ")}.`
    );
  }

  return topics.map((t) => {
    const topicOrder = order.get(t.tempId)!;
    return { tempId: t.tempId, order: topicOrder, parallelGroup: `tier_${topicOrder}` };
  });
}

export interface DomainTopicOrderRef {
  domainTempId: string;
  order: number;
}

/**
 * Graceful Over-Large-Goal Handling addition: splits domains into up to `maxPhases` sequential
 * groups, each becoming its own Path when a decomposition is too large to persist as one. Domains
 * are sorted by their EARLIEST topic tier (computeCrossDomainOrder's own `order` above) and then
 * chunked into contiguous, roughly-even-sized groups in that sorted order — a domain is never
 * split across phases (this partitions strictly along existing domain boundaries, it never
 * re-decomposes anything), and because domains are ordered by their real, already-computed
 * prerequisite tier first, phase 1 always contains the domains whose topics are genuine
 * prerequisites for later phases' domains, not an arbitrary grouping.
 */
export function partitionDomainsIntoPhases(
  domainTempIds: string[],
  topicRefs: DomainTopicOrderRef[],
  maxPhases = 3
): string[][] {
  if (domainTempIds.length === 0) return [];

  const minOrderByDomain = new Map<string, number>();
  for (const t of topicRefs) {
    const current = minOrderByDomain.get(t.domainTempId);
    if (current === undefined || t.order < current) minOrderByDomain.set(t.domainTempId, t.order);
  }

  const sorted = [...domainTempIds].sort(
    (a, b) => (minOrderByDomain.get(a) ?? 0) - (minOrderByDomain.get(b) ?? 0)
  );

  const phaseCount = Math.min(maxPhases, sorted.length);
  const baseSize = Math.floor(sorted.length / phaseCount);
  const remainder = sorted.length % phaseCount;

  const phases: string[][] = [];
  let cursor = 0;
  for (let i = 0; i < phaseCount; i++) {
    const size = baseSize + (i < remainder ? 1 : 0);
    phases.push(sorted.slice(cursor, cursor + size));
    cursor += size;
  }
  return phases;
}
