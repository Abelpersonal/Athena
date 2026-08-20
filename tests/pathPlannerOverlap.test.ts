import { describe, it, expect } from "vitest";
import {
  decideOverlapBranch,
  resolveOverlapForTopic,
  extractCourseIdsFromHistory,
  DEFAULT_HIGH_SCORE_THRESHOLD,
  DEFAULT_RECHECK_WINDOW_DAYS,
  type OverlapCandidate,
} from "../src/pathPlanner/overlap.js";
import type { OrchestratorResult, RunOptions } from "../src/orchestrator/index.js";
import type { TopicHistoryResult } from "../src/memoryGraph/index.js";

const NOW = new Date("2026-06-01T00:00:00.000Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

function candidate(overrides: Partial<OverlapCandidate> = {}): OverlapCandidate {
  return {
    courseId: "crs_1",
    goalContext: null,
    volatilityTier: "medium",
    aggregateKnowledgeScore: 0.9,
    lastUpdated: daysAgo(1),
    ...overrides,
  };
}

describe("decideOverlapBranch (pure)", () => {
  it("no_match: no candidate course found -> pending", () => {
    expect(decideOverlapBranch(null, "Goal X", NOW)).toEqual({ kind: "no_match" });
  });

  it("not_yet_mastered: candidate exists but score is below the high-score threshold", () => {
    const c = candidate({ aggregateKnowledgeScore: 0.4 });
    expect(decideOverlapBranch(c, "Goal X", NOW)).toEqual({ kind: "not_yet_mastered", courseId: "crs_1" });
  });

  it("not_yet_mastered: candidate exists but has no quiz history at all (null score)", () => {
    const c = candidate({ aggregateKnowledgeScore: null });
    expect(decideOverlapBranch(c, "Goal X", NOW)).toEqual({ kind: "not_yet_mastered", courseId: "crs_1" });
  });

  it("angle_mismatch: high score, recent, but built under a DIFFERENT goal's angle — takes precedence over recency", () => {
    const c = candidate({ goalContext: "Goal Y", aggregateKnowledgeScore: 0.95, lastUpdated: daysAgo(1) });
    expect(decideOverlapBranch(c, "Goal X", NOW)).toEqual({ kind: "angle_mismatch", courseId: "crs_1" });
  });

  it("does NOT flag a mismatch when the candidate has no goalContext (built standalone — generically compatible)", () => {
    const c = candidate({ goalContext: null, aggregateKnowledgeScore: 0.95, lastUpdated: daysAgo(1) });
    expect(decideOverlapBranch(c, "Goal X", NOW)).toEqual({ kind: "fresh_high_score", courseId: "crs_1" });
  });

  it("does NOT flag a mismatch when the candidate's goalContext matches the current one (case/whitespace-insensitive)", () => {
    const c = candidate({ goalContext: "  Goal X  ", aggregateKnowledgeScore: 0.95, lastUpdated: daysAgo(1) });
    expect(decideOverlapBranch(c, "goal x", NOW)).toEqual({ kind: "fresh_high_score", courseId: "crs_1" });
  });

  it("fresh_high_score: high score, angle-compatible, within the volatility-tier recheck window", () => {
    const c = candidate({ volatilityTier: "medium", lastUpdated: daysAgo(10) }); // medium window default: 90 days
    expect(decideOverlapBranch(c, "Goal X", NOW)).toEqual({ kind: "fresh_high_score", courseId: "crs_1" });
  });

  it("stale_needs_refresh: high score, angle-compatible, but past the volatility-tier recheck window", () => {
    const c = candidate({ volatilityTier: "fast", lastUpdated: daysAgo(45) }); // fast window default: 30 days
    const result = decideOverlapBranch(c, "Goal X", NOW);
    expect(result.kind).toBe("stale_needs_refresh");
    if (result.kind === "stale_needs_refresh") {
      expect(result.courseId).toBe("crs_1");
      expect(result.ageDays).toBeCloseTo(45, 0);
    }
  });

  it("treats a candidate with no lastUpdated at all as infinitely stale", () => {
    const c = candidate({ lastUpdated: null });
    const result = decideOverlapBranch(c, "Goal X", NOW);
    expect(result.kind).toBe("stale_needs_refresh");
  });

  it("respects custom thresholds when provided", () => {
    const c = candidate({ aggregateKnowledgeScore: 0.5 });
    expect(decideOverlapBranch(c, "Goal X", NOW, { highScoreThreshold: 0.4 }).kind).toBe("fresh_high_score");
  });

  it("resolved defaults match the PRD's documented values", () => {
    expect(DEFAULT_HIGH_SCORE_THRESHOLD).toBe(0.75);
    expect(DEFAULT_RECHECK_WINDOW_DAYS).toEqual({ fast: 30, medium: 90, slow: 180, mixed: 90 });
  });
});

describe("extractCourseIdsFromHistory", () => {
  it("recovers course ids embedded in episode content/source_description text", () => {
    const history: TopicHistoryResult = {
      nodes: [],
      facts: [],
      episodes: [
        {
          uuid: "e1",
          name: "Course: Linear Algebra",
          content: 'The course "Linear Algebra" was built (course_id: crs_abc123).',
          created_at: null,
          source: "text",
          source_description: "Teacher Course Builder (course_id: crs_abc123)",
          group_id: "main",
        },
      ],
    };
    expect(extractCourseIdsFromHistory(history)).toEqual(["crs_abc123"]);
  });

  it("returns an empty array when no episode mentions a course_id", () => {
    const history: TopicHistoryResult = { nodes: [], facts: [], episodes: [] };
    expect(extractCourseIdsFromHistory(history)).toEqual([]);
  });
});

type MockRun = (
  taskType: string,
  context: Record<string, unknown>,
  callingModule: string,
  options?: RunOptions
) => Promise<OrchestratorResult<unknown>>;

function refreshCheckMock(stillAccurate: boolean): MockRun {
  return async (taskType) => ({
    taskType,
    promptVersion: "test",
    data: { stillAccurate, reason: stillAccurate ? "Nothing has changed." : "This has clearly gone stale." },
    attempts: 1,
    raw: "{}",
  });
}

describe("resolveOverlapForTopic (async orchestration, hits all four PRD scenarios)", () => {
  it("pending: no candidate course found at all", async () => {
    const result = await resolveOverlapForTopic("Brand New Topic", "Goal X", {
      findCandidateCourse: async () => null,
    });
    expect(result).toMatchObject({ status: "pending", branch: "no_match" });
    expect(result.courseId).toBeUndefined();
  });

  it("pending: candidate exists but isn't mastered yet", async () => {
    const result = await resolveOverlapForTopic("Topic", "Goal X", {
      findCandidateCourse: async () => candidate({ aggregateKnowledgeScore: 0.3 }),
      now: NOW,
    });
    expect(result).toMatchObject({ status: "pending", branch: "not_yet_mastered" });
  });

  it("linked_existing: mastered recently with a high score — links the existing course_id", async () => {
    const result = await resolveOverlapForTopic("Topic", "Goal X", {
      findCandidateCourse: async () => candidate({ lastUpdated: daysAgo(5) }),
      now: NOW,
    });
    expect(result).toEqual({
      status: "linked_existing",
      courseId: "crs_1",
      branch: "fresh_high_score",
      reason: expect.any(String),
    });
  });

  it("delta_needed: mastered, but under a different goal's angle", async () => {
    const result = await resolveOverlapForTopic("Topic", "Goal X", {
      findCandidateCourse: async () => candidate({ goalContext: "Some Other Goal", lastUpdated: daysAgo(5) }),
      now: NOW,
    });
    expect(result.status).toBe("delta_needed");
    expect(result.branch).toBe("angle_mismatch");
    expect(result.courseId).toBeUndefined(); // no course_id linked for delta_needed — see README
  });

  it("linked_existing via quick refresh: stale but the refresh check finds it's still accurate", async () => {
    const result = await resolveOverlapForTopic("Topic", "Goal X", {
      findCandidateCourse: async () => candidate({ volatilityTier: "fast", lastUpdated: daysAgo(60) }),
      getExistingLessonTitles: async () => ["Lesson A", "Lesson B"],
      orchestratorRun: refreshCheckMock(true) as never,
      now: NOW,
    });
    expect(result).toEqual({
      status: "linked_existing",
      courseId: "crs_1",
      branch: "stale_recheck_passed",
      reason: "Nothing has changed.",
    });
  });

  it("pending via quick refresh: stale and the refresh check finds real gaps — regenerate", async () => {
    const result = await resolveOverlapForTopic("Topic", "Goal X", {
      findCandidateCourse: async () => candidate({ volatilityTier: "fast", lastUpdated: daysAgo(60) }),
      getExistingLessonTitles: async () => ["Lesson A"],
      orchestratorRun: refreshCheckMock(false) as never,
      now: NOW,
    });
    expect(result).toEqual({
      status: "pending",
      branch: "stale_recheck_failed",
      reason: "This has clearly gone stale.",
    });
    expect(result.courseId).toBeUndefined();
  });
});
