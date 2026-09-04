import { eq, inArray, isNull, isNotNull } from "drizzle-orm";
import { getDb, type TeacherDb } from "./client.js";
import {
  courses,
  modules,
  lessons,
  sources,
  paths,
  pathTopics,
  masteryState,
  mindMaps,
  lessonUpdates,
  activityEvents,
  type MindMapGraph,
} from "./schema.js";
import { computeStreak, selectWeakestConceptLesson, isPathInactive, type StreakResult, type ReentryOffer } from "../motivation/pure.js";
import { DEFAULT_WEAK_CONCEPT_THRESHOLD } from "../quizEngine/index.js";
import { getRecentCourseDomains, isDomainClusterNarrow } from "../continuousLearning/index.js";

/**
 * Phase 7: cross-cutting, read-only queries for the frontend's Dashboard/Course/Lesson screens —
 * shapes that don't obviously belong to one existing agent module (unlike e.g. loadPathRoadmap,
 * src/pathPlanner/index.ts, which the Path view reuses directly unchanged). No writes here; every
 * mutation still goes through the module that owns it.
 */

export interface DashboardCourse {
  id: string;
  topic: string;
  status: "building" | "complete";
  volatilityTier: "fast" | "medium" | "slow" | "mixed";
  createdAt: string;
  moduleCount: number;
  lessonCount: number;
}

/** In-progress courses: not yet learner-completed (completedAt is null), regardless of content-pipeline status. */
export async function getDashboardCourses(options: { db?: TeacherDb } = {}): Promise<DashboardCourse[]> {
  const db = options.db ?? (await getDb());
  const rows = await db.select().from(courses).where(isNull(courses.completedAt));

  const out: DashboardCourse[] = [];
  for (const c of rows) {
    const courseModules = await db.select().from(modules).where(eq(modules.courseId, c.id));
    let lessonCount = 0;
    for (const m of courseModules) {
      lessonCount += (await db.select().from(lessons).where(eq(lessons.moduleId, m.id))).length;
    }
    out.push({
      id: c.id,
      topic: c.topic,
      status: c.status,
      volatilityTier: c.volatilityTier,
      createdAt: c.createdAt,
      moduleCount: courseModules.length,
      lessonCount,
    });
  }
  return out.sort((a, b) => (b.createdAt < a.createdAt ? -1 : 1));
}

export interface DashboardCompletedCourse {
  id: string;
  topic: string;
  completedAt: string;
}

/** Learner-completed courses (completedAt set) — what the Dashboard offers an on-demand "Get suggestions" action for. */
export async function getCompletedCourses(options: { db?: TeacherDb } = {}): Promise<DashboardCompletedCourse[]> {
  const db = options.db ?? (await getDb());
  const rows = await db.select().from(courses).where(isNotNull(courses.completedAt));
  return rows
    .map((c) => ({ id: c.id, topic: c.topic, completedAt: c.completedAt! }))
    .sort((a, b) => (b.completedAt < a.completedAt ? -1 : 1));
}

export interface ActivePathProgress {
  id: string;
  goalDescription: string;
  createdAt: string;
  topicCount: number;
  /** Topics whose status is "mastered" or "linked_existing" — the Path view's own definition of "has a ready course." */
  doneCount: number;
}

/** Active paths (paths.status = "active") with a topic-completion progress count, for the Dashboard's path list. */
export async function getActivePathsWithProgress(options: { db?: TeacherDb } = {}): Promise<ActivePathProgress[]> {
  const db = options.db ?? (await getDb());
  const rows = await db.select().from(paths).where(eq(paths.status, "active"));

  const out: ActivePathProgress[] = [];
  for (const p of rows) {
    const topics = await db.select().from(pathTopics).where(eq(pathTopics.pathId, p.id));
    const doneCount = topics.filter((t) => t.status === "mastered" || t.status === "linked_existing").length;
    out.push({ id: p.id, goalDescription: p.goalDescription, createdAt: p.createdAt, topicCount: topics.length, doneCount });
  }
  return out.sort((a, b) => (b.createdAt < a.createdAt ? -1 : 1));
}

/** The Path row itself (loadPathRoadmap, src/pathPlanner/index.ts, returns only its topics — the Path view also needs the goal description/status). */
export async function getPathMeta(
  pathId: string,
  options: { db?: TeacherDb } = {}
): Promise<typeof paths.$inferSelect | null> {
  const db = options.db ?? (await getDb());
  const [path] = await db.select().from(paths).where(eq(paths.id, pathId));
  return path ?? null;
}

export interface CourseDetailLesson {
  id: string;
  title: string;
  description: string;
  estimatedDuration: string;
  sourceStatus: "ok" | "below_threshold";
  knowledgeScore: number | null;
  experienceScore: number | null;
  sourceRefs: LessonSourceRef[];
}
export interface CourseDetailModule {
  id: string;
  title: string;
  description: string;
  order: number;
  lessons: CourseDetailLesson[];
}
export interface CourseDetail {
  course: typeof courses.$inferSelect;
  modules: CourseDetailModule[];
}

/** The Course view's full read: modules in persisted order, each lesson with its current MasteryState (concept_node_id = lesson_id, per Phase 4's documented granularity). */
export async function getCourseDetail(courseId: string, options: { db?: TeacherDb } = {}): Promise<CourseDetail | null> {
  const db = options.db ?? (await getDb());
  const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
  if (!course) return null;

  const moduleRows = await db.select().from(modules).where(eq(modules.courseId, courseId));
  moduleRows.sort((a, b) => a.order - b.order);

  const detailModules: CourseDetailModule[] = [];
  for (const m of moduleRows) {
    const lessonRows = await db.select().from(lessons).where(eq(lessons.moduleId, m.id));
    const detailLessons: CourseDetailLesson[] = [];
    for (const l of lessonRows) {
      const [mastery] = await db.select().from(masteryState).where(eq(masteryState.conceptNodeId, l.id));
      const sourceRows =
        l.sourceRefs.length > 0 ? await db.select().from(sources).where(inArray(sources.id, l.sourceRefs)) : [];
      detailLessons.push({
        id: l.id,
        title: l.title,
        description: l.description,
        estimatedDuration: l.estimatedDuration,
        sourceStatus: l.sourceStatus,
        knowledgeScore: mastery?.knowledgeScore ?? null,
        experienceScore: mastery?.experienceScore ?? null,
        sourceRefs: sourceRows.map((s) => ({ id: s.id, url: s.url, type: s.type, credibilityScore: s.credibilityScore })),
      });
    }
    detailModules.push({ id: m.id, title: m.title, description: m.description, order: m.order, lessons: detailLessons });
  }

  return { course, modules: detailModules };
}

export interface CourseMindMapData {
  /** null when this course has no mindMaps row yet (e.g. built before Phase 8, or the LLM step degraded during build) — the Course view falls back to the plain list in that case. */
  graph: MindMapGraph | null;
  /** Lesson ids with an associated lessonUpdates row (Phase 6's major-delta records) — read-only; no Phase 6 write path is touched by this query. */
  updatedLessonIds: string[];
}

/** The Course view's mind map read: the persisted graph (if any) plus which of its nodes' lessons have a Phase 6 "update lesson" — the graph's freshness indicator. */
export async function getCourseMindMap(courseId: string, options: { db?: TeacherDb } = {}): Promise<CourseMindMapData> {
  const db = options.db ?? (await getDb());
  const [mindMap] = await db.select().from(mindMaps).where(eq(mindMaps.courseId, courseId));
  if (!mindMap) return { graph: null, updatedLessonIds: [] };

  const lessonIds = mindMap.graphJson.nodes.map((n) => n.id);
  const updates =
    lessonIds.length > 0 ? await db.select().from(lessonUpdates).where(inArray(lessonUpdates.lessonId, lessonIds)) : [];

  return { graph: mindMap.graphJson, updatedLessonIds: [...new Set(updates.map((u) => u.lessonId))] };
}

export interface LessonSourceRef {
  id: string;
  url: string;
  type: "article" | "pdf" | "video" | "other" | "unreachable" | "low_confidence";
  credibilityScore: number;
}

export interface LessonWithSources {
  lesson: typeof lessons.$inferSelect;
  moduleId: string;
  courseId: string;
  courseTopic: string;
  sourceRefs: LessonSourceRef[];
}

/** A lesson joined with its real linked sources — the Course/Lesson views' "citations, one tap away" panel. */
export async function getLessonWithSources(
  lessonId: string,
  options: { db?: TeacherDb } = {}
): Promise<LessonWithSources | null> {
  const db = options.db ?? (await getDb());
  const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId));
  if (!lesson) return null;

  const [mod] = await db.select().from(modules).where(eq(modules.id, lesson.moduleId));
  if (!mod) return null;
  const [course] = await db.select().from(courses).where(eq(courses.id, mod.courseId));
  if (!course) return null;

  const sourceRows =
    lesson.sourceRefs.length > 0 ? await db.select().from(sources).where(inArray(sources.id, lesson.sourceRefs)) : [];

  return {
    lesson,
    moduleId: mod.id,
    courseId: course.id,
    courseTopic: course.topic,
    sourceRefs: sourceRows.map((s) => ({ id: s.id, url: s.url, type: s.type, credibilityScore: s.credibilityScore })),
  };
}

/** Momentum framing (Phase 9, Deliverable 2): "X days of momentum" computed fresh from every real ActivityEvent — no separate streak counter column to keep in sync with the events that actually determine it. */
export async function getMomentumStreak(options: { db?: TeacherDb; now?: Date } = {}): Promise<StreakResult> {
  const db = options.db ?? (await getDb());
  const rows = await db.select({ occurredAt: activityEvents.occurredAt }).from(activityEvents);
  return computeStreak(
    rows.map((r) => r.occurredAt),
    options.now
  );
}

/** Low-friction re-entry (Phase 9, Deliverable 3): the single weakest-scoring lesson across every in-progress course, or null when nothing needs it. Reuses quizEngine's own weak-concept threshold — never a second scoring system. */
export async function getReentryOffer(options: { db?: TeacherDb } = {}): Promise<ReentryOffer | null> {
  const db = options.db ?? (await getDb());
  const inProgressCourses = await db.select().from(courses).where(isNull(courses.completedAt));

  const candidates: { lessonId: string; lessonTitle: string; courseId: string; courseTopic: string; knowledgeScore: number | null }[] = [];
  for (const c of inProgressCourses) {
    const courseModules = await db.select().from(modules).where(eq(modules.courseId, c.id));
    for (const m of courseModules) {
      const lessonRows = await db.select().from(lessons).where(eq(lessons.moduleId, m.id));
      for (const l of lessonRows) {
        const [mastery] = await db.select().from(masteryState).where(eq(masteryState.conceptNodeId, l.id));
        candidates.push({
          lessonId: l.id,
          lessonTitle: l.title,
          courseId: c.id,
          courseTopic: c.topic,
          knowledgeScore: mastery?.knowledgeScore ?? null,
        });
      }
    }
  }
  return selectWeakestConceptLesson(candidates, DEFAULT_WEAK_CONCEPT_THRESHOLD);
}

export interface BoredomProofingSuggestion {
  pathId: string;
  goalDescription: string;
  message: string;
}

/**
 * Boredom-proofing (Phase 9, Deliverable 4): a path that's gone quiet specifically — no
 * ActivityEvent on any of its own courses in the inactivity window, while the app HAS seen real
 * activity elsewhere in that same window (see isPathInactive, src/motivation/pure.ts). Recomputed
 * fresh every Dashboard load — the same "don't persist Suggestion records" simplification Phase 6
 * already made for its own next-topic suggestions. The framing reuses Phase 6's existing
 * diversity signal (getRecentCourseDomains + isDomainClusterNarrow, src/continuousLearning/
 * index.ts) verbatim to decide the copy, not a second diversity algorithm and not a new LLM call
 * of its own — though getRecentCourseDomains DOES make a real `infer_course_domain` LLM call per
 * completed course that isn't Path-linked, so that step is wrapped and degrades to the plain
 * (non-diversity-biased) copy on failure, the same "an enrichment step, not a precondition"
 * policy applied elsewhere in this phase (see getGoalConnectionMessage) — this runs on every
 * Dashboard page load, so an LLM hiccup here must never take the whole Dashboard down.
 */
export async function getBoredomProofingSuggestions(
  options: { db?: TeacherDb; now?: Date } = {}
): Promise<BoredomProofingSuggestion[]> {
  const db = options.db ?? (await getDb());
  const now = options.now ?? new Date();

  const activePaths = await db.select().from(paths).where(eq(paths.status, "active"));
  if (activePaths.length === 0) return [];

  const allEvents = await db.select({ courseId: activityEvents.courseId, occurredAt: activityEvents.occurredAt }).from(activityEvents);

  const flagged: (typeof paths.$inferSelect)[] = [];
  for (const p of activePaths) {
    const topics = await db.select().from(pathTopics).where(eq(pathTopics.pathId, p.id));
    const pathCourseIds = new Set(topics.map((t) => t.courseId).filter((id): id is string => id !== null));
    if (pathCourseIds.size === 0) continue;

    const pathTimestamps = allEvents.filter((e) => pathCourseIds.has(e.courseId)).map((e) => e.occurredAt);
    const otherTimestamps = allEvents.filter((e) => !pathCourseIds.has(e.courseId)).map((e) => e.occurredAt);

    if (isPathInactive(pathTimestamps, otherTimestamps, now)) flagged.push(p);
  }
  if (flagged.length === 0) return [];

  let diversityBiasApplied = false;
  try {
    const recentDomains = await getRecentCourseDomains({ db });
    diversityBiasApplied = isDomainClusterNarrow(recentDomains);
  } catch (error) {
    console.error(`[boredom-proofing] Failed to compute the recent-domain diversity signal: ${(error as Error).message}`);
  }

  return flagged.map((p) => ({
    pathId: p.id,
    goalDescription: p.goalDescription,
    message: diversityBiasApplied
      ? "This path's gone quiet, and recent activity elsewhere has clustered pretty narrowly too — a genuine change of pace might help."
      : "This path's gone quiet while you've been active elsewhere — pick it back up, or try something different for a bit.",
  }));
}
