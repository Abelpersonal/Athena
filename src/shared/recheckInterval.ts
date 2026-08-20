export type VolatilityTier = "fast" | "medium" | "slow" | "mixed";

/**
 * Phase 6: the formalized recheck interval, shared by Phase 5's overlap detection
 * (src/pathPlanner/overlap.ts) and Phase 6's Knowledge Update Agent due-topic selection
 * (src/knowledgeUpdate/index.ts) — a single exported function so the two phases can't drift into
 * inconsistent definitions of "stale." Lives here (src/shared/), not inside either phase's own
 * module, specifically so Phase 5 can depend on it without creating a backwards Phase-5-imports-
 * from-Phase-6 dependency.
 *
 * Phase 5 originally approximated this as a stopgap (30/90/180/90 days for fast/medium/slow/mixed)
 * while waiting for this phase. These are the formalized defaults per the PRD's resolved answer:
 * fast=14, medium=60, slow=180 — "mixed" wasn't specified by the PRD (a course's aggregated
 * volatility tier when its subtopics disagree; see courses.volatilityTier), so it defaults to
 * medium's value as a reasonable middle ground, independently configurable like every other tier.
 */
export const DEFAULT_RECHECK_INTERVAL_DAYS: Record<VolatilityTier, number> = {
  fast: Number(process.env.RECHECK_INTERVAL_DAYS_FAST ?? 14),
  medium: Number(process.env.RECHECK_INTERVAL_DAYS_MEDIUM ?? 60),
  slow: Number(process.env.RECHECK_INTERVAL_DAYS_SLOW ?? 180),
  mixed: Number(process.env.RECHECK_INTERVAL_DAYS_MIXED ?? 60),
};

export function getRecheckIntervalDays(
  tier: VolatilityTier,
  overrides: Partial<Record<VolatilityTier, number>> = DEFAULT_RECHECK_INTERVAL_DAYS
): number {
  return overrides[tier] ?? DEFAULT_RECHECK_INTERVAL_DAYS[tier];
}
