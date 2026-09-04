import { describe, it, expect } from "vitest";
import {
  computeStreak,
  selectWeakestConceptLesson,
  isPathInactive,
  shouldShowGoalConnection,
  isEngagementNudgeDue,
  type ReentryCandidateLesson,
} from "../src/motivation/pure.js";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-03-10T12:00:00.000Z");
function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * DAY_MS).toISOString();
}

describe("computeStreak", () => {
  it("returns 0/null for no events at all", () => {
    expect(computeStreak([], NOW)).toEqual({ currentStreakDays: 0, lastActiveDate: null });
  });

  it("counts 1 for a single event today", () => {
    const result = computeStreak([daysAgo(0)], NOW);
    expect(result.currentStreakDays).toBe(1);
    expect(result.lastActiveDate).toBe("2026-03-10");
  });

  it("counts consecutive calendar days including today", () => {
    const result = computeStreak([daysAgo(0), daysAgo(1), daysAgo(2)], NOW);
    expect(result.currentStreakDays).toBe(3);
  });

  it("still shows the streak when the most recent activity was yesterday, not yet today (no shaming for not having logged in yet today)", () => {
    const result = computeStreak([daysAgo(1), daysAgo(2), daysAgo(3)], NOW);
    expect(result.currentStreakDays).toBe(3);
    expect(result.lastActiveDate).toBe("2026-03-09");
  });

  it("a gap in the middle stops the count at the gap, not the full history", () => {
    // Active today and yesterday, but NOT the day before — a real 3-day-old event shouldn't extend the count.
    const result = computeStreak([daysAgo(0), daysAgo(1), daysAgo(3)], NOW);
    expect(result.currentStreakDays).toBe(2);
  });

  it("quietly resets to 0 (no shaming) once the gap since the last activity is 2+ days, but still reports the real lastActiveDate", () => {
    const result = computeStreak([daysAgo(5), daysAgo(4)], NOW);
    expect(result.currentStreakDays).toBe(0);
    expect(result.lastActiveDate).toBe("2026-03-06");
  });

  it("multiple events on the same calendar day only count once", () => {
    const result = computeStreak([daysAgo(0), new Date(NOW.getTime() - 1000).toISOString(), new Date(NOW.getTime() - 2000).toISOString()], NOW);
    expect(result.currentStreakDays).toBe(1);
  });
});

describe("selectWeakestConceptLesson", () => {
  const threshold = 0.6;

  it("returns null when nothing scores below the threshold", () => {
    const lessons: ReentryCandidateLesson[] = [
      { lessonId: "l1", lessonTitle: "L1", courseId: "c1", courseTopic: "T1", knowledgeScore: 0.8 },
      { lessonId: "l2", lessonTitle: "L2", courseId: "c1", courseTopic: "T1", knowledgeScore: null },
    ];
    expect(selectWeakestConceptLesson(lessons, threshold)).toBeNull();
  });

  it("picks the single lowest-scoring lesson below the threshold", () => {
    const lessons: ReentryCandidateLesson[] = [
      { lessonId: "l1", lessonTitle: "L1", courseId: "c1", courseTopic: "T1", knowledgeScore: 0.5 },
      { lessonId: "l2", lessonTitle: "L2", courseId: "c1", courseTopic: "T1", knowledgeScore: 0.2 },
      { lessonId: "l3", lessonTitle: "L3", courseId: "c2", courseTopic: "T2", knowledgeScore: 0.9 },
    ];
    const result = selectWeakestConceptLesson(lessons, threshold);
    expect(result?.lessonId).toBe("l2");
  });

  it("ignores lessons with a null (never scored) knowledgeScore", () => {
    const lessons: ReentryCandidateLesson[] = [{ lessonId: "l1", lessonTitle: "L1", courseId: "c1", courseTopic: "T1", knowledgeScore: null }];
    expect(selectWeakestConceptLesson(lessons, threshold)).toBeNull();
  });

  it("picks across courses, not just within one", () => {
    const lessons: ReentryCandidateLesson[] = [
      { lessonId: "l1", lessonTitle: "L1", courseId: "c1", courseTopic: "T1", knowledgeScore: 0.55 },
      { lessonId: "l2", lessonTitle: "L2", courseId: "c2", courseTopic: "T2", knowledgeScore: 0.1 },
    ];
    expect(selectWeakestConceptLesson(lessons, threshold)?.courseId).toBe("c2");
  });
});

describe("isPathInactive", () => {
  it("is false when the path itself has recent activity", () => {
    expect(isPathInactive([daysAgo(1)], [], NOW)).toBe(false);
  });

  it("is false when NEITHER the path nor anything else has recent activity (not this path's problem to flag)", () => {
    expect(isPathInactive([daysAgo(20)], [daysAgo(20)], NOW)).toBe(false);
  });

  it("is true when the path has gone quiet specifically WHILE other activity is real and recent", () => {
    expect(isPathInactive([daysAgo(20)], [daysAgo(1)], NOW)).toBe(true);
  });

  it("respects a custom window", () => {
    // Path's most recent activity is 10 days ago — inactive under the default 7-day window...
    expect(isPathInactive([daysAgo(10)], [daysAgo(1)], NOW, 7)).toBe(true);
    // ...but NOT under a wider 14-day window.
    expect(isPathInactive([daysAgo(10)], [daysAgo(1)], NOW, 14)).toBe(false);
  });

  it("empty path event history with real recent activity elsewhere counts as inactive", () => {
    expect(isPathInactive([], [daysAgo(0)], NOW)).toBe(true);
  });
});

describe("shouldShowGoalConnection", () => {
  it("is true when nothing has ever been shown", () => {
    expect(shouldShowGoalConnection(null, NOW)).toBe(true);
  });

  it("is false shortly after the last time it was shown", () => {
    expect(shouldShowGoalConnection(new Date(NOW.getTime() - 2 * 3_600_000).toISOString(), NOW, 20)).toBe(false);
  });

  it("is true again once the cadence window has elapsed", () => {
    expect(shouldShowGoalConnection(new Date(NOW.getTime() - 21 * 3_600_000).toISOString(), NOW, 20)).toBe(true);
  });
});

describe("isEngagementNudgeDue (Phase 10 push cadence)", () => {
  // Whether a path is CURRENTLY inactive is decided upstream (isPathInactive /
  // findInactivePathForNudge) before this is ever called — this function only answers "has a
  // nudge already been sent for this same stretch," given the flagged path's OWN most recent
  // ActivityEvent (never a global one — see the function's doc comment for why).

  it("is true the first time (no nudge has ever been sent)", () => {
    expect(isEngagementNudgeDue(daysAgo(10), null)).toBe(true);
  });

  it("is true even when the flagged path has literally never had any activity, if no nudge was ever sent", () => {
    expect(isEngagementNudgeDue(null, null)).toBe(true);
  });

  it("stays false on a repeated scheduled-check run for the SAME inactivity stretch (a nudge already sent, no fresher activity on this path since)", () => {
    const lastPathActivity = daysAgo(10);
    const nudgeSentAfterThatActivity = daysAgo(9); // sent shortly after the inactivity was first detected
    expect(isEngagementNudgeDue(lastPathActivity, nudgeSentAfterThatActivity)).toBe(false);
  });

  it("becomes true again once fresh activity on THIS PATH happens after the last nudge (a genuinely new episode)", () => {
    const nudgeSentAt = daysAgo(15);
    const freshPathActivityAfterThatNudge = daysAgo(10); // the learner came back to this path...
    expect(isEngagementNudgeDue(freshPathActivityAfterThatNudge, nudgeSentAt)).toBe(true);
  });

  it("stays false when a nudge was sent but the path has never had any activity to reference as 'fresh'", () => {
    expect(isEngagementNudgeDue(null, daysAgo(15))).toBe(false);
  });
});
