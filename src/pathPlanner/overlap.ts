import { eq } from "drizzle-orm";
import { run as orchestratorRun } from "../orchestrator/index.js";
import type { QuickRefreshCheckOutput } from "../orchestrator/templates/quickRefreshCheck.js";
import { getDb, type TeacherDb } from "../db/client.js";
import { courses, modules, lessons, masteryState } from "../db/schema.js";
import { getTopicHistory as getTopicHistoryDefault } from "../memoryGraph/index.js";
import type { TopicHistoryResult } from "../memoryGraph/index.js";

export type OrchestratorRunFn = typeof orchestratorRun;
export type VolatilityTier = "fast" | "medium" | "slow" | "mixed";

/**
 * Overlap detection (Phase 5, Deliverable 3). For each PathTopic, before any
 * course generation happens, this decides one of four outcomes against
 * Phase 4's MasteryState (SQLite) and Phase 3.5's Memory Graph
 * (getTopicHistory()) — see README, "Overlap detection thresholds and
 * branch logic" for the full writeup and the concrete thresholds chosen.
 */

export interface OverlapCandidate {
  courseId: string;
  /** null = built standalone/no goal bias (generic fundamentals, always angle-compatible); non-null = built under a specific goal's framing. */
  goalContext: string | null;
  volatilityTier: VolatilityTier;
  /** Average of MasteryState.knowledgeScore across the course's lessons that HAVE a score; null if none do. */
  aggregateKnowledgeScore: number | null;
  /** Most recent MasteryState.lastUpdated among the course's scored lessons; null if none do. */
  lastUpdated: string | null;
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Extracts "course_id: X" mentions from Memory Graph episode text.
 * writeTopic()'s episode_body/source_description (src/memoryGraph/index.ts)
 * embed this verbatim, so this is a real (not guessed) way to recover a
 * candidate course id purely from what the graph remembers about a topic —
 * useful when a topic was researched under a differently-worded course
 * title than the exact PathTopic name.
 */
export function extractCourseIdsFromHistory(history: TopicHistoryResult): string[] {
  const ids = new Set<string>();
  const pattern = /course_id:\s*([A-Za-z0-9_-]+)/g;
  for (const episode of history.episodes) {
    for (const text of [episode.content, episode.source_description]) {
      if (!text) continue;
      for (const match of text.matchAll(pattern)) ids.add(match[1]!);
    }
  }
  return [...ids];
}

async function aggregateCourseMastery(
  db: TeacherDb,
  courseId: string
): Promise<{ aggregateKnowledgeScore: number | null; lastUpdated: string | null }> {
  const courseLessons = await db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId));
  if (courseLessons.length === 0) return { aggregateKnowledgeScore: null, lastUpdated: null };

  const scores: number[] = [];
  let lastUpdated: string | null = null;
  for (const lesson of courseLessons) {
    const [row] = await db.select().from(masteryState).where(eq(masteryState.conceptNodeId, lesson.id));
    if (row?.knowledgeScore !== null && row?.knowledgeScore !== undefined) {
      scores.push(row.knowledgeScore);
      if (!lastUpdated || row.lastUpdated > lastUpdated) lastUpdated = row.lastUpdated;
    }
  }
  if (scores.length === 0) return { aggregateKnowledgeScore: null, lastUpdated: null };
  return { aggregateKnowledgeScore: scores.reduce((a, b) => a + b, 0) / scores.length, lastUpdated };
}

export type FindCandidateCourseFn = (topicName: string) => Promise<OverlapCandidate | null>;

/**
 * Real default implementation: SQLite is authoritative for "does a course
 * with a matching topic exist, and what's its aggregate mastery" (it has
 * the structured joins MasteryState needs); getTopicHistory() supplements
 * it — if no exact `courses.topic` match is found, a graph text search for
 * the topic can still recover a course id via extractCourseIdsFromHistory(),
 * which SQLite alone can't do for a differently-worded course title.
 */
export function createFindCandidateCourse(
  db: TeacherDb,
  getTopicHistoryFn: typeof getTopicHistoryDefault = getTopicHistoryDefault
): FindCandidateCourseFn {
  return async (topicName: string): Promise<OverlapCandidate | null> => {
    const normalized = normalize(topicName);
    const allCourses = await db.select().from(courses);
    let matched = allCourses.find((c) => normalize(c.topic) === normalized);

    if (!matched) {
      const history = await getTopicHistoryFn(topicName);
      for (const id of extractCourseIdsFromHistory(history)) {
        const found = allCourses.find((c) => c.id === id);
        if (found) {
          matched = found;
          break;
        }
      }
    }
    if (!matched) return null;

    const { aggregateKnowledgeScore, lastUpdated } = await aggregateCourseMastery(db, matched.id);
    return {
      courseId: matched.id,
      goalContext: matched.goalContext,
      volatilityTier: matched.volatilityTier,
      aggregateKnowledgeScore,
      lastUpdated,
    };
  };
}

export function createGetExistingLessonTitles(db: TeacherDb): (courseId: string) => Promise<string[]> {
  return async (courseId: string) => {
    const rows = await db
      .select({ title: lessons.title })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .where(eq(modules.courseId, courseId));
    return rows.map((r) => r.title);
  };
}

/** "High score" threshold, per the PRD's resolved default: reuses Phase 4's weak-concept threshold (0.6) inversely, at 0.75. */
export const DEFAULT_HIGH_SCORE_THRESHOLD = Number(process.env.PATH_HIGH_SCORE_THRESHOLD ?? 0.75);

/**
 * "Past volatility recheck window" default, per the PRD's resolved default:
 * a simple date check (last_updated older than a volatility-tier-based
 * interval) rather than blocking on Phase 6's Knowledge Update Agent
 * recheck-scheduling logic, which doesn't exist yet — Phase 6 will formalize
 * this later.
 */
export const DEFAULT_RECHECK_WINDOW_DAYS: Record<VolatilityTier, number> = {
  fast: Number(process.env.PATH_RECHECK_WINDOW_DAYS_FAST ?? 30),
  medium: Number(process.env.PATH_RECHECK_WINDOW_DAYS_MEDIUM ?? 90),
  slow: Number(process.env.PATH_RECHECK_WINDOW_DAYS_SLOW ?? 180),
  mixed: Number(process.env.PATH_RECHECK_WINDOW_DAYS_MIXED ?? 90),
};

export interface OverlapThresholds {
  highScoreThreshold?: number;
  recheckWindowDaysByTier?: Record<VolatilityTier, number>;
}

/**
 * The pure decision core — no DB, no LLM, no I/O — so it's directly unit
 * testable for every branch by just constructing candidate objects. Mirrors
 * the codebase's "compute deterministically in code, don't trust the model
 * with the aggregate decision" philosophy: the only genuinely fuzzy call
 * (has the topic gone stale?) is deliberately left as its own async step
 * (see resolveOverlapForTopic) rather than folded in here.
 *
 * Precedence, matching the PRD's bullet order: no candidate -> pending; a
 * candidate below the high-score threshold -> pending (not yet mastered);
 * ANGLE mismatch is checked before recency (a fresh, high-scoring course
 * built for a different goal's emphasis still needs a delta); only once the
 * angle is compatible does recency decide fresh-reuse vs. a refresh check.
 */
export function decideOverlapBranch(
  candidate: OverlapCandidate | null,
  currentGoalContext: string,
  now: Date,
  thresholds: OverlapThresholds = {}
):
  | { kind: "no_match" }
  | { kind: "not_yet_mastered"; courseId: string }
  | { kind: "angle_mismatch"; courseId: string }
  | { kind: "fresh_high_score"; courseId: string }
  | { kind: "stale_needs_refresh"; courseId: string; ageDays: number } {
  if (!candidate) return { kind: "no_match" };

  const highScoreThreshold = thresholds.highScoreThreshold ?? DEFAULT_HIGH_SCORE_THRESHOLD;
  if (candidate.aggregateKnowledgeScore === null || candidate.aggregateKnowledgeScore < highScoreThreshold) {
    return { kind: "not_yet_mastered", courseId: candidate.courseId };
  }

  const angleMismatch = candidate.goalContext !== null && normalize(candidate.goalContext) !== normalize(currentGoalContext);
  if (angleMismatch) {
    return { kind: "angle_mismatch", courseId: candidate.courseId };
  }

  const windowDays = (thresholds.recheckWindowDaysByTier ?? DEFAULT_RECHECK_WINDOW_DAYS)[candidate.volatilityTier];
  const ageDays = candidate.lastUpdated
    ? (now.getTime() - new Date(candidate.lastUpdated).getTime()) / 86_400_000
    : Number.POSITIVE_INFINITY;
  if (ageDays > windowDays) {
    return { kind: "stale_needs_refresh", courseId: candidate.courseId, ageDays };
  }

  return { kind: "fresh_high_score", courseId: candidate.courseId };
}

export type OverlapStatus = "pending" | "linked_existing" | "delta_needed";
export type OverlapBranchKind =
  | "no_match"
  | "not_yet_mastered"
  | "angle_mismatch"
  | "fresh_high_score"
  | "stale_recheck_passed"
  | "stale_recheck_failed";

export interface OverlapResult {
  status: OverlapStatus;
  courseId?: string;
  /** Which of the PRD's scenarios actually fired — distinguishes e.g. "fresh_high_score" from "stale_recheck_passed" even though both resolve to the same linked_existing status. */
  branch: OverlapBranchKind;
  reason: string;
}

export interface ResolveOverlapOptions extends OverlapThresholds {
  orchestratorRun?: OrchestratorRunFn;
  db?: TeacherDb;
  /** Injectable for tests — mock this to hit every branch without a real DB/graph. Default: the real SQLite+Memory-Graph lookup. */
  findCandidateCourse?: FindCandidateCourseFn;
  getExistingLessonTitles?: (courseId: string) => Promise<string[]>;
  now?: Date;
}

/**
 * Resolves one PathTopic's overlap status. Combines the pure branch decision
 * above with the one genuinely async step it can trigger (a quick_refresh_check
 * LLM call for a stale-but-previously-high-scoring match) and turns the result
 * into the three PathTopic.status values Deliverable 3 actually persists.
 */
export async function resolveOverlapForTopic(
  topicName: string,
  currentGoalContext: string,
  options: ResolveOverlapOptions = {}
): Promise<OverlapResult> {
  const run = options.orchestratorRun ?? orchestratorRun;
  // Lazy: only actually opens a (real, unless options.db is set) DB connection if one of the
  // default collaborators below is genuinely invoked — when both findCandidateCourse and
  // getExistingLessonTitles are injected (as tests do, to hit every branch without a real DB or
  // Memory Graph), no DB connection is ever opened.
  let dbPromise: Promise<TeacherDb> | undefined;
  const resolveDb = (): Promise<TeacherDb> => (dbPromise ??= options.db ? Promise.resolve(options.db) : getDb());
  const findCandidateCourse =
    options.findCandidateCourse ?? (async (topic: string) => createFindCandidateCourse(await resolveDb())(topic));
  const getExistingLessonTitles =
    options.getExistingLessonTitles ??
    (async (courseId: string) => createGetExistingLessonTitles(await resolveDb())(courseId));
  const now = options.now ?? new Date();

  const candidate = await findCandidateCourse(topicName);
  const branch = decideOverlapBranch(candidate, currentGoalContext, now, {
    highScoreThreshold: options.highScoreThreshold,
    recheckWindowDaysByTier: options.recheckWindowDaysByTier,
  });

  switch (branch.kind) {
    case "no_match":
      return { status: "pending", branch: "no_match", reason: `No existing course found covering "${topicName}".` };

    case "not_yet_mastered":
      return {
        status: "pending",
        branch: "not_yet_mastered",
        reason:
          candidate!.aggregateKnowledgeScore === null
            ? `Found course ${branch.courseId} for "${topicName}" but it has no quiz history yet.`
            : `Found course ${branch.courseId} but its knowledge_score (${candidate!.aggregateKnowledgeScore.toFixed(2)}) is below the mastery threshold.`,
      };

    case "angle_mismatch":
      return {
        status: "delta_needed",
        branch: "angle_mismatch",
        reason: `Course ${branch.courseId} covers "${topicName}" and is well-mastered, but was built under a different goal angle ("${candidate!.goalContext}") — a targeted delta is needed for "${currentGoalContext}".`,
      };

    case "fresh_high_score":
      return {
        status: "linked_existing",
        courseId: branch.courseId,
        branch: "fresh_high_score",
        reason: `Course ${branch.courseId} is recently verified and high-scoring for "${topicName}" — reusing it directly.`,
      };

    case "stale_needs_refresh": {
      const lessonTitles = await getExistingLessonTitles(branch.courseId);
      const refresh = await run<QuickRefreshCheckOutput>(
        "quick_refresh_check",
        {
          topicName,
          volatilityTier: candidate!.volatilityTier,
          daysSinceLastVerified: Math.round(branch.ageDays),
          existingLessonTitles: lessonTitles,
        },
        "path-planner-overlap"
      );
      if (refresh.data.stillAccurate) {
        return {
          status: "linked_existing",
          courseId: branch.courseId,
          branch: "stale_recheck_passed",
          reason: refresh.data.reason,
        };
      }
      return { status: "pending", branch: "stale_recheck_failed", reason: refresh.data.reason };
    }
  }
}
