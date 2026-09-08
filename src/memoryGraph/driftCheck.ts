import { eq } from "drizzle-orm";
import { getDb, type TeacherDb } from "../db/client.js";
import { courses, modules, lessons, masteryState } from "../db/schema.js";
import {
  getTopicHistory as getTopicHistoryDefault,
  getCrossCourseConnections as getCrossCourseConnectionsDefault,
} from "./index.js";

export type GetTopicHistoryFn = typeof getTopicHistoryDefault;
export type GetCrossCourseConnectionsFn = typeof getCrossCourseConnectionsDefault;

export type CourseDriftStatus = "in_sync" | "missing_from_graph" | "possibly_stale";

export interface CourseDriftEntry {
  courseId: string;
  topic: string;
  status: CourseDriftStatus;
  graphNodeCount: number;
  graphFactCount: number;
  /** Lessons under this course with a real (non-null) knowledgeScore or experienceScore in SQLite. */
  sqliteMasteryActivityCount: number;
  connectedTopicsInGraph: number;
  detail: string;
}

export interface DriftReport {
  reachable: boolean;
  /** Set only when `reachable` is false — the graph error that stopped the check partway through. `entries` still holds whatever courses were checked before that happened. */
  error?: string;
  checkedAt: string;
  entries: CourseDriftEntry[];
  driftedCount: number;
}

export interface DriftCheckOptions {
  db?: TeacherDb;
  getTopicHistory?: GetTopicHistoryFn;
  getCrossCourseConnections?: GetCrossCourseConnectionsFn;
}

/**
 * Read-only reconciliation check comparing what SQLite knows exists (real, persisted `courses`
 * rows and their lessons' `MasteryState`) against what the Memory Graph's own read functions —
 * `getTopicHistory()` and `getCrossCourseConnections()`, the only two exposed, deliberately not a
 * new graph query — report actually landed there. This exists because every Memory Graph WRITE
 * (`writeTopic`, `writeMasteryUpdate`, `writeSubtopicFacts`, ...) is designed to degrade silently
 * on failure (log and skip, never block course generation — see src/memoryGraph/index.ts), which
 * is correct for keeping the app usable but means the graph can fall behind SQLite over time with
 * nothing to notice or report it. Both the Goal Planner's overlap detection and the Knowledge
 * Update Agent's delta detection read their history FROM the graph, so a silently-diverged graph
 * means those two agents could be working from stale data with no visible warning — this check
 * exists purely to make that visible, not to fix it.
 *
 * **This is a diagnostic, not a repair tool.** It never re-writes anything into the graph; it only
 * reports what it finds. Two drift signals, deliberately kept simple and structurally justified
 * rather than guessed:
 *
 * - `"missing_from_graph"`: SQLite has a real course for this topic, but `getTopicHistory()`
 *   reports zero nodes AND zero facts for it — `writeTopic()` (called once, at Course Builder
 *   time, for every course) apparently never landed, or the graph has lost this course entirely.
 *   This is the reliable, primary signal the whole check exists for.
 * - `"possibly_stale"`: the topic DOES have some graph presence (so it was written at build time),
 *   but real mastery activity has since happened in SQLite (`masteryState` rows with a non-null
 *   score exist for its lessons — every quiz/practice completion calls `writeMasteryUpdate()`, see
 *   src/quizEngine/index.ts and src/practiceEngine/index.ts) while the graph reports zero facts at
 *   all for the topic. Named "possibly" deliberately: Graphiti's own fact-extraction pipeline
 *   processes a freshly-written episode asynchronously, so a very recent update can legitimately
 *   not be a searchable "fact" yet — this isn't proof of a lost write the way `missing_from_graph`
 *   is, just a real, worth-a-look signal.
 *
 * What this check does NOT attempt, and why: per-lesson mastery freshness (there is no graph query
 * scoped to a single lesson/conceptNodeId — `getTopicHistory()` only takes a topic string), and any
 * staleness signal based on `episodes` (`get_episodes` returns recent episodes GLOBALLY, not
 * scoped to a topic — see getTopicHistory's own doc comment — so a topic's episode count says
 * nothing reliable about that topic specifically). `connectedTopicsInGraph` is included per entry
 * purely as informational context (it comes from the same best-effort text-pattern match
 * `getCrossCourseConnections()` already documents as being only as precise as its regex); a course
 * with zero cross-course connections is completely normal, not drift, so it never affects `status`.
 *
 * Degrades exactly like every other Memory Graph read: if the graph is genuinely unreachable
 * (Docker not running), `getTopicHistory()` returns an `error` string instead of throwing. Rather
 * than retrying that same failing connection once per course (slow, and every subsequent call
 * would fail identically — see graphitiClient.ts's `ensureConnectedSafe()`), this check stops as
 * soon as the first `error` comes back and reports `reachable: false` with whatever courses were
 * genuinely checked before that — never crashes, and never mistakes "couldn't check" for "found no
 * drift."
 */
export async function checkGraphDrift(options: DriftCheckOptions = {}): Promise<DriftReport> {
  const db = options.db ?? (await getDb());
  const getTopicHistory = options.getTopicHistory ?? getTopicHistoryDefault;
  const getCrossCourseConnections = options.getCrossCourseConnections ?? getCrossCourseConnectionsDefault;
  const checkedAt = new Date().toISOString();

  const allCourses = await db.select().from(courses);
  const entries: CourseDriftEntry[] = [];
  let unreachableError: string | undefined;

  for (const course of allCourses) {
    const history = await getTopicHistory(course.topic);
    if (history.error) {
      unreachableError = history.error;
      break;
    }

    let sqliteMasteryActivityCount = 0;
    const courseModules = await db.select().from(modules).where(eq(modules.courseId, course.id));
    for (const courseModule of courseModules) {
      const courseLessons = await db.select().from(lessons).where(eq(lessons.moduleId, courseModule.id));
      for (const lesson of courseLessons) {
        const [mastery] = await db.select().from(masteryState).where(eq(masteryState.conceptNodeId, lesson.id));
        if (mastery && (mastery.knowledgeScore !== null || mastery.experienceScore !== null)) {
          sqliteMasteryActivityCount++;
        }
      }
    }

    const connections = await getCrossCourseConnections(course.topic);
    const connectedTopicsInGraph = connections.error ? 0 : connections.connectedTopics.length;

    const hasAnyGraphPresence = history.nodes.length > 0 || history.facts.length > 0;
    let status: CourseDriftStatus;
    let detail: string;
    if (!hasAnyGraphPresence) {
      status = "missing_from_graph";
      detail = `SQLite has a real course for "${course.topic}" (id ${course.id}), but the graph reports zero nodes and zero facts for it — writeTopic() may never have landed, or the graph has lost this course entirely.`;
    } else if (sqliteMasteryActivityCount > 0 && history.facts.length === 0) {
      status = "possibly_stale";
      detail = `${sqliteMasteryActivityCount} lesson(s) under "${course.topic}" have real mastery activity in SQLite, but the graph reports zero facts for this topic — only its build-time nodes, if any, are present.`;
    } else {
      status = "in_sync";
      detail = `Graph reports ${history.nodes.length} node(s) and ${history.facts.length} fact(s) for "${course.topic}", consistent with real SQLite activity.`;
    }

    entries.push({
      courseId: course.id,
      topic: course.topic,
      status,
      graphNodeCount: history.nodes.length,
      graphFactCount: history.facts.length,
      sqliteMasteryActivityCount,
      connectedTopicsInGraph,
      detail,
    });
  }

  const driftedCount = entries.filter((e) => e.status !== "in_sync").length;
  if (unreachableError) {
    return { reachable: false, error: unreachableError, checkedAt, entries, driftedCount };
  }
  return { reachable: true, checkedAt, entries, driftedCount };
}
