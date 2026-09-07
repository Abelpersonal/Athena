import { randomBytes } from "node:crypto";
import type { RawGoalDecomposition } from "../../../src/pathPlanner/index.js";

/**
 * Graceful Over-Large-Goal Handling addition: an oversized decomposition is now decided on by the
 * user (proceed / split / abort) as a SEPARATE step from decomposing it, so the two real [LLM]
 * calls (decompose_goal_into_path, determine_cross_domain_dependencies) never need to be re-run
 * just because the user needed a moment to choose. `EventSource`/GET is what every other SSE route
 * in this app already uses (see app/api/_sse.ts's doc comment) and can't carry a request body or a
 * large query string reliably — so the raw decomposition is stashed here, server-side, in memory,
 * keyed by a short-lived opaque id the client only ever passes back as a small query param.
 *
 * A plain module-level Map is sufficient (not a DB table, not Redis) for the same reason
 * `orchestrator/index.ts`'s session cost accumulator is a plain module-level variable: this is a
 * single-process, single-user personal app, not a distributed system. Entries are one-shot
 * (removed the moment they're resolved) and time-bounded (a stale, never-resolved entry — the user
 * abandoned the tab — is swept out after TTL_MS rather than leaking forever across a long-running
 * dev server process).
 */
const TTL_MS = 15 * 60 * 1000;

interface StashedEntry {
  decomposition: RawGoalDecomposition;
  expiresAt: number;
}

const pending = new Map<string, StashedEntry>();

function sweepExpired(): void {
  const now = Date.now();
  for (const [id, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(id);
  }
}

export function stashPendingDecomposition(decomposition: RawGoalDecomposition): string {
  sweepExpired();
  const id = `pd_${randomBytes(8).toString("hex")}`;
  pending.set(id, { decomposition, expiresAt: Date.now() + TTL_MS });
  return id;
}

/** One-shot: a resolved (or expired) id is removed and returns null — never returned twice. */
export function takePendingDecomposition(id: string): RawGoalDecomposition | null {
  sweepExpired();
  const entry = pending.get(id);
  if (!entry) return null;
  pending.delete(id);
  return entry.decomposition;
}
