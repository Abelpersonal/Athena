/**
 * Motivation/Engagement Layer (Phase 9): pure logic only — no DB, no LLM — so every threshold and
 * branch is directly unit testable by constructing plain inputs. Same "hard logic is a pure
 * function, DB/LLM parts are thin wrappers" split as Phase 5's computeCrossDomainOrder
 * (src/pathPlanner/ordering.ts) and Phase 8's computeMindMapLayout (src/mindMap/layout.ts).
 * Deliberately free of any import from another agent module (quizEngine, continuousLearning,
 * etc.) — callers pass in whatever real threshold they want reused (e.g.
 * quizEngine.DEFAULT_WEAK_CONCEPT_THRESHOLD), so this file can never form an import cycle with
 * the engines that call into it.
 */

export interface StreakResult {
  currentStreakDays: number;
  /** UTC calendar-day string (YYYY-MM-DD) of the most recent activity, or null if there's none yet. */
  lastActiveDate: string | null;
}

function toUtcDateString(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * "X days of momentum" (§5.12b's own phrasing preference over generic streak language) —
 * consecutive CALENDAR days (UTC, not the learner's local timezone — a v1 simplification, see
 * README) with at least one ActivityEvent of ANY type. No broken-streak shaming: a streak more
 * than one calendar day stale doesn't return a negative number, a "you lost your streak" signal,
 * or a comparison to a prior best — it quietly reports 0, and the Dashboard simply omits the
 * momentum line in that case rather than showing a red "broken" state.
 */
export function computeStreak(eventTimestamps: string[], now: Date = new Date()): StreakResult {
  if (eventTimestamps.length === 0) return { currentStreakDays: 0, lastActiveDate: null };

  const activeDates = new Set(eventTimestamps.map(toUtcDateString));
  const mostRecent = [...activeDates].sort().at(-1)!;

  const todayStr = now.toISOString().slice(0, 10);
  const yesterdayStr = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  if (mostRecent !== todayStr && mostRecent !== yesterdayStr) {
    // Lapsed (a gap of 2+ days since the last activity) — quietly reset, not shown as "broken."
    return { currentStreakDays: 0, lastActiveDate: mostRecent };
  }

  let streakDays = 0;
  let cursor = new Date(`${mostRecent}T00:00:00.000Z`);
  while (activeDates.has(cursor.toISOString().slice(0, 10))) {
    streakDays += 1;
    cursor = new Date(cursor.getTime() - 86_400_000);
  }
  return { currentStreakDays: streakDays, lastActiveDate: mostRecent };
}

export interface ReentryCandidateLesson {
  lessonId: string;
  lessonTitle: string;
  courseId: string;
  courseTopic: string;
  knowledgeScore: number | null;
}
export interface ReentryOffer {
  lessonId: string;
  lessonTitle: string;
  courseId: string;
  courseTopic: string;
  knowledgeScore: number;
}

/**
 * Picks the single weakest-scoring lesson across every in-progress course's lessons, for the
 * Dashboard's low-friction "Quick review"/"5-minute check-in" offers (Deliverable 3). Reuses
 * quizEngine's own weak-concept threshold — passed in by the caller, never re-imported here — so
 * there is exactly one definition of "weak," not a second one drifting alongside it. Returns null
 * when nothing scores below the threshold: no offer is forced onto a learner who's simply doing
 * fine everywhere.
 */
export function selectWeakestConceptLesson(lessons: ReentryCandidateLesson[], threshold: number): ReentryOffer | null {
  let weakest: ReentryOffer | null = null;
  for (const l of lessons) {
    if (l.knowledgeScore === null || l.knowledgeScore >= threshold) continue;
    if (weakest === null || l.knowledgeScore < weakest.knowledgeScore) {
      weakest = { lessonId: l.lessonId, lessonTitle: l.lessonTitle, courseId: l.courseId, courseTopic: l.courseTopic, knowledgeScore: l.knowledgeScore };
    }
  }
  return weakest;
}

/** Resolved default: 7 days of no activity on a path's own courses, while the app HAS seen real activity elsewhere in that same window. */
export const DEFAULT_BOREDOM_INACTIVITY_DAYS = Number(process.env.BOREDOM_INACTIVITY_DAYS ?? 7);

/**
 * True when a path has genuinely "gone quiet" SPECIFICALLY — no ActivityEvent on any of its own
 * courses in `windowDays`, while there HAS been real activity elsewhere (other paths/courses) in
 * that same window. A learner who simply hasn't opened the app at all doesn't hit this — that's a
 * different, not-this-phase's problem (see the Phase 9 kickoff's own scope note), not a reason to
 * single out one path as "quiet."
 */
export function isPathInactive(
  pathEventTimestamps: string[],
  otherEventTimestamps: string[],
  now: Date = new Date(),
  windowDays: number = DEFAULT_BOREDOM_INACTIVITY_DAYS
): boolean {
  const cutoff = now.getTime() - windowDays * 86_400_000;
  const pathRecentlyActive = pathEventTimestamps.some((t) => new Date(t).getTime() >= cutoff);
  if (pathRecentlyActive) return false;
  return otherEventTimestamps.some((t) => new Date(t).getTime() >= cutoff);
}

/** Resolved default: roughly once per real day (§5.12b's own word: "occasional[ly]"). */
export const DEFAULT_GOAL_CONNECTION_MIN_HOURS = Number(process.env.GOAL_CONNECTION_MIN_HOURS ?? 20);

/** A lightweight last-shown timestamp check, not a notification-scheduling system — see README. */
export function shouldShowGoalConnection(
  lastShownAt: string | null,
  now: Date = new Date(),
  minHours: number = DEFAULT_GOAL_CONNECTION_MIN_HOURS
): boolean {
  if (!lastShownAt) return true;
  const hoursSince = (now.getTime() - new Date(lastShownAt).getTime()) / 3_600_000;
  return hoursSince >= minHours;
}

/**
 * Phase 10, Deliverable 5: the real engagement-nudge push's "at most one" cadence gate — §5.12b's
 * own bar: "at most one low-pressure re-engagement message after inactivity." This is deliberately
 * NOT a second inactivity check — whether a path is currently quiet is already decided by
 * `isPathInactive` (findInactivePathForNudge, src/engagementCheck/index.ts) before this function
 * is ever called. This function answers a narrower question: has a nudge already been sent for
 * THIS SAME inactivity stretch? `mostRecentPathEventTimestamp` is the flagged path's OWN most
 * recent `ActivityEvent` (not a global/app-wide one — using the global signal would mean an
 * unrelated active path's recent activity could wrongly suppress a real nudge about a different,
 * genuinely quiet one). Due when: no nudge has ever been sent (`lastNudgeSentAt` null), OR the
 * flagged path has seen genuinely fresh activity AFTER the last nudge (the learner came back, then
 * went quiet again — a new, distinct episode). Not due when the path's own last activity is at or
 * before the last nudge — the same continuous stretch a nudge already covered, which is exactly
 * what keeps a repeated scheduled-check run from ever sending a second nudge for it.
 */
export function isEngagementNudgeDue(mostRecentPathEventTimestamp: string | null, lastNudgeSentAt: string | null): boolean {
  if (!lastNudgeSentAt) return true;
  if (!mostRecentPathEventTimestamp) return false;
  return mostRecentPathEventTimestamp > lastNudgeSentAt;
}
