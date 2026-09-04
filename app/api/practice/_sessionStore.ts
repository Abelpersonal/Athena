import { randomUUID } from "node:crypto";
import type { PracticeSession, DialogueHistoryEntry } from "../../../src/practiceEngine/index.js";

/**
 * In-memory practice session state, keyed by session id — API-layer glue, not an agent pipeline,
 * deliberately NOT added to src/ (keeping "src/ is the only place agent pipelines live" intact).
 * Same "don't design ahead of an actual need" judgment call Phase 6 made for Suggestion records:
 * no new DB table for in-flight sessions. A page refresh mid-session loses this state — an
 * accepted v1 gap (documented in the README), not a bug — the persisted PracticeAttempt/
 * MasteryState rows only get written once /reflect actually completes.
 *
 * This Map only survives for the life of the Next.js dev/production server process — restarting
 * it (or, in dev, a file edit that triggers a full server restart rather than Fast Refresh) clears
 * every in-flight session, same caveat.
 */
export interface PracticeSessionState {
  session: PracticeSession;
  history: DialogueHistoryEntry[];
  critique?: string;
  performanceScore?: number;
  reflectionPrompt?: string;
}

const store = new Map<string, PracticeSessionState>();

export function createPracticeSession(session: PracticeSession): string {
  const sessionId = randomUUID();
  store.set(sessionId, { session, history: [] });
  return sessionId;
}

export function getPracticeSession(sessionId: string): PracticeSessionState | undefined {
  return store.get(sessionId);
}

export function updatePracticeSession(sessionId: string, patch: Partial<PracticeSessionState>): void {
  const existing = store.get(sessionId);
  if (!existing) return;
  store.set(sessionId, { ...existing, ...patch });
}

export function deletePracticeSession(sessionId: string): void {
  store.delete(sessionId);
}
