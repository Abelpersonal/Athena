import { describe, it, expect, beforeEach } from "vitest";
import {
  getDashboardCourses,
  getCompletedCourses,
  getActivePathsWithProgress,
  getLessonWithSources,
  getCourseDetail,
  getCourseMindMap,
  getMomentumStreak,
  getReentryOffer,
  getBoredomProofingSuggestions,
} from "../src/db/queries.js";
import { getDb, resetDbCache } from "../src/db/client.js";
import {
  courses,
  modules,
  lessons,
  sources,
  paths,
  pathDomains,
  pathTopics,
  mindMaps,
  updateEvents,
  lessonUpdates,
  masteryState,
  activityEvents,
} from "../src/db/schema.js";
import type { TeacherDb } from "../src/db/client.js";

const LAYER_TEXT = { text: "t", source_ids: [] };
const FIVE_LAYERS = {
  intuition: LAYER_TEXT,
  mechanics: LAYER_TEXT,
  formal: LAYER_TEXT,
  application: LAYER_TEXT,
  frontier: LAYER_TEXT,
};

describe("getDashboardCourses / getCompletedCourses", () => {
  beforeEach(() => resetDbCache());

  it("separates in-progress (completedAt null) from completed courses", async () => {
    const db = await getDb(":memory:");
    await db.insert(courses).values([
      { id: "crs_in_progress", topic: "In Progress", createdAt: "2026-01-01T00:00:00.000Z", volatilityTier: "medium", status: "complete", completedAt: null },
      { id: "crs_done", topic: "Done", createdAt: "2026-01-02T00:00:00.000Z", volatilityTier: "medium", status: "complete", completedAt: "2026-02-01T00:00:00.000Z" },
    ]);

    const inProgress = await getDashboardCourses({ db });
    expect(inProgress.map((c) => c.id)).toEqual(["crs_in_progress"]);

    const completed = await getCompletedCourses({ db });
    expect(completed.map((c) => c.id)).toEqual(["crs_done"]);
  });

  it("counts modules and lessons correctly for an in-progress course", async () => {
    const db = await getDb(":memory:");
    await db.insert(courses).values({ id: "crs_counted", topic: "Counted", createdAt: "2026-01-01T00:00:00.000Z", volatilityTier: "medium", status: "building" });
    await db.insert(modules).values([
      { id: "mod_a", courseId: "crs_counted", title: "A", description: "d", order: 0, prerequisiteOf: [] },
      { id: "mod_b", courseId: "crs_counted", title: "B", description: "d", order: 1, prerequisiteOf: [] },
    ]);
    await db.insert(lessons).values([
      { id: "lsn_a1", moduleId: "mod_a", title: "A1", description: "d", estimatedDuration: "5 min", layers: FIVE_LAYERS, sourceRefs: [], sourceStatus: "ok" },
      { id: "lsn_a2", moduleId: "mod_a", title: "A2", description: "d", estimatedDuration: "5 min", layers: FIVE_LAYERS, sourceRefs: [], sourceStatus: "ok" },
      { id: "lsn_b1", moduleId: "mod_b", title: "B1", description: "d", estimatedDuration: "5 min", layers: FIVE_LAYERS, sourceRefs: [], sourceStatus: "ok" },
    ]);

    const [course] = await getDashboardCourses({ db });
    expect(course!.moduleCount).toBe(2);
    expect(course!.lessonCount).toBe(3);
  });
});

describe("getActivePathsWithProgress", () => {
  beforeEach(() => resetDbCache());

  it("only returns active paths, with a done-count of mastered/linked_existing topics", async () => {
    const db = await getDb(":memory:");
    await db.insert(paths).values([
      { id: "path_active", goalDescription: "Active Goal", createdAt: "2026-01-01T00:00:00.000Z", status: "active" },
      { id: "path_completed", goalDescription: "Completed Goal", createdAt: "2026-01-01T00:00:00.000Z", status: "completed" },
    ]);
    await db.insert(pathDomains).values({ id: "dom_1", pathId: "path_active", name: "Math", order: 0 });
    await db.insert(pathTopics).values([
      { id: "pt_1", pathId: "path_active", domainId: "dom_1", topicName: "T1", description: "d", order: 0, parallelGroup: "tier_0", status: "linked_existing" },
      { id: "pt_2", pathId: "path_active", domainId: "dom_1", topicName: "T2", description: "d", order: 0, parallelGroup: "tier_0", status: "mastered" },
      { id: "pt_3", pathId: "path_active", domainId: "dom_1", topicName: "T3", description: "d", order: 1, parallelGroup: "tier_1", status: "pending" },
    ]);

    const result = await getActivePathsWithProgress({ db });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("path_active");
    expect(result[0]!.topicCount).toBe(3);
    expect(result[0]!.doneCount).toBe(2);
  });
});

describe("getLessonWithSources", () => {
  beforeEach(() => resetDbCache());

  async function seed(db: TeacherDb) {
    await db.insert(courses).values({ id: "crs_ls", topic: "Sourced Topic", createdAt: "2026-01-01T00:00:00.000Z", volatilityTier: "medium", status: "complete" });
    await db.insert(modules).values({ id: "mod_ls", courseId: "crs_ls", title: "M", description: "d", order: 0, prerequisiteOf: [] });
    await db.insert(sources).values([
      { id: "src_ls_1", url: "https://example.com/a", type: "article", extractedText: "text a", credibilityScore: 0.8, fetchedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    await db.insert(lessons).values({
      id: "lsn_ls",
      moduleId: "mod_ls",
      title: "Lesson With Sources",
      description: "d",
      estimatedDuration: "5 min",
      layers: FIVE_LAYERS,
      sourceRefs: [{ sourceId: "src_ls_1" }],
      sourceStatus: "ok",
    });
  }

  it("returns the lesson joined with its real course/module context and source refs", async () => {
    const db = await getDb(":memory:");
    await seed(db);

    const result = await getLessonWithSources("lsn_ls", { db });
    expect(result).not.toBeNull();
    expect(result!.courseId).toBe("crs_ls");
    expect(result!.courseTopic).toBe("Sourced Topic");
    expect(result!.moduleId).toBe("mod_ls");
    expect(result!.sourceRefs).toEqual([{ id: "src_ls_1", url: "https://example.com/a", type: "article", credibilityScore: 0.8 }]);
  });

  it("returns null for an unknown lesson id", async () => {
    const db = await getDb(":memory:");
    expect(await getLessonWithSources("does-not-exist", { db })).toBeNull();
  });

  it("returns an empty sourceRefs array (not an error) for a lesson with no linked sources yet", async () => {
    const db = await getDb(":memory:");
    await db.insert(courses).values({ id: "crs_nosrc", topic: "No Sources Yet", createdAt: "2026-01-01T00:00:00.000Z", volatilityTier: "medium", status: "building" });
    await db.insert(modules).values({ id: "mod_nosrc", courseId: "crs_nosrc", title: "M", description: "d", order: 0, prerequisiteOf: [] });
    await db.insert(lessons).values({
      id: "lsn_nosrc",
      moduleId: "mod_nosrc",
      title: "No Sources",
      description: "d",
      estimatedDuration: "5 min",
      layers: FIVE_LAYERS,
      sourceRefs: [],
      sourceStatus: "below_threshold",
    });

    const result = await getLessonWithSources("lsn_nosrc", { db });
    expect(result!.sourceRefs).toEqual([]);
  });

  it("includes a source's real locator when one was cited (Pre-Real-Testing Gap Fixes, Deliverable 2)", async () => {
    const db = await getDb(":memory:");
    await db.insert(courses).values({ id: "crs_loc", topic: "Locator Topic", createdAt: "2026-01-01T00:00:00.000Z", volatilityTier: "medium", status: "complete" });
    await db.insert(modules).values({ id: "mod_loc", courseId: "crs_loc", title: "M", description: "d", order: 0, prerequisiteOf: [] });
    await db.insert(sources).values([
      { id: "src_pdf", url: "https://example.com/paper.pdf", type: "pdf", extractedText: "page text", credibilityScore: 0.85, fetchedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    await db.insert(lessons).values({
      id: "lsn_loc",
      moduleId: "mod_loc",
      title: "Lesson With A Locator",
      description: "d",
      estimatedDuration: "5 min",
      layers: FIVE_LAYERS,
      sourceRefs: [
        { sourceId: "src_pdf", locator: { type: "page", value: 4 } },
        { sourceId: "src_pdf", locator: { type: "page", value: 9 } },
      ],
      sourceStatus: "ok",
    });

    const result = await getLessonWithSources("lsn_loc", { db });
    expect(result!.sourceRefs).toEqual([
      { id: "src_pdf", url: "https://example.com/paper.pdf", type: "pdf", credibilityScore: 0.85, locator: { type: "page", value: 4 } },
      { id: "src_pdf", url: "https://example.com/paper.pdf", type: "pdf", credibilityScore: 0.85, locator: { type: "page", value: 9 } },
    ]);
  });

  it("reads a pre-migration lesson whose sourceRefs is still the old bare source-id-string shape, with no locator and no crash", async () => {
    const db = await getDb(":memory:");
    await db.insert(courses).values({ id: "crs_old", topic: "Old Shape Topic", createdAt: "2026-01-01T00:00:00.000Z", volatilityTier: "medium", status: "complete" });
    await db.insert(modules).values({ id: "mod_old", courseId: "crs_old", title: "M", description: "d", order: 0, prerequisiteOf: [] });
    await db.insert(sources).values([
      { id: "src_old_1", url: "https://example.com/old", type: "article", extractedText: "old text", credibilityScore: 0.7, fetchedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    // Simulates a row persisted before this phase's schema change — its real, raw JSON is a bare
    // array of id strings, not {sourceId, locator?} objects. Bypassing the (now-updated) insert
    // type deliberately, since this is exactly what already-persisted data looks like.
    await db.insert(lessons).values({
      id: "lsn_old",
      moduleId: "mod_old",
      title: "Old Shape Lesson",
      description: "d",
      estimatedDuration: "5 min",
      layers: FIVE_LAYERS,
      sourceRefs: ["src_old_1"] as unknown as { sourceId: string }[],
      sourceStatus: "ok",
    });

    const result = await getLessonWithSources("lsn_old", { db });
    expect(result!.sourceRefs).toEqual([
      { id: "src_old_1", url: "https://example.com/old", type: "article", credibilityScore: 0.7 },
    ]);
  });
});

describe("getCourseDetail", () => {
  beforeEach(() => resetDbCache());

  it("joins each lesson's real sourceRefs, including a locator when one was cited (Course view's own read path)", async () => {
    const db = await getDb(":memory:");
    await db.insert(courses).values({ id: "crs_detail", topic: "Detail Topic", createdAt: "2026-01-01T00:00:00.000Z", volatilityTier: "medium", status: "complete" });
    await db.insert(modules).values({ id: "mod_detail", courseId: "crs_detail", title: "M", description: "d", order: 0, prerequisiteOf: [] });
    await db.insert(sources).values([
      { id: "src_video", url: "https://youtube.com/watch?v=abc", type: "video", extractedText: "caption text", credibilityScore: 0.8, fetchedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    await db.insert(lessons).values({
      id: "lsn_detail",
      moduleId: "mod_detail",
      title: "Lesson",
      description: "d",
      estimatedDuration: "5 min",
      layers: FIVE_LAYERS,
      sourceRefs: [{ sourceId: "src_video", locator: { type: "timestamp", value: "4:32" } }],
      sourceStatus: "ok",
    });

    const result = await getCourseDetail("crs_detail", { db });
    expect(result!.modules[0]!.lessons[0]!.sourceRefs).toEqual([
      { id: "src_video", url: "https://youtube.com/watch?v=abc", type: "video", credibilityScore: 0.8, locator: { type: "timestamp", value: "4:32" } },
    ]);
  });

  it("reads a pre-migration lesson's old bare-string-array sourceRefs correctly, with no locator and no crash", async () => {
    const db = await getDb(":memory:");
    await db.insert(courses).values({ id: "crs_detail_old", topic: "Old Topic", createdAt: "2026-01-01T00:00:00.000Z", volatilityTier: "medium", status: "complete" });
    await db.insert(modules).values({ id: "mod_detail_old", courseId: "crs_detail_old", title: "M", description: "d", order: 0, prerequisiteOf: [] });
    await db.insert(sources).values([
      { id: "src_detail_old", url: "https://example.com/old", type: "article", extractedText: "old text", credibilityScore: 0.6, fetchedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    await db.insert(lessons).values({
      id: "lsn_detail_old",
      moduleId: "mod_detail_old",
      title: "Old Lesson",
      description: "d",
      estimatedDuration: "5 min",
      layers: FIVE_LAYERS,
      sourceRefs: ["src_detail_old"] as unknown as { sourceId: string }[],
      sourceStatus: "ok",
    });

    const result = await getCourseDetail("crs_detail_old", { db });
    expect(result!.modules[0]!.lessons[0]!.sourceRefs).toEqual([
      { id: "src_detail_old", url: "https://example.com/old", type: "article", credibilityScore: 0.6 },
    ]);
  });

  it("returns null for an unknown course id", async () => {
    const db = await getDb(":memory:");
    expect(await getCourseDetail("does-not-exist", { db })).toBeNull();
  });
});

describe("getCourseMindMap", () => {
  beforeEach(() => resetDbCache());

  async function seedCourseWithLessons(db: TeacherDb, courseId: string, lessonIds: string[]) {
    await db.insert(courses).values({ id: courseId, topic: "T", createdAt: "2026-01-01T00:00:00.000Z", volatilityTier: "medium", status: "complete" });
    await db.insert(modules).values({ id: `mod_${courseId}`, courseId, title: "M", description: "d", order: 0, prerequisiteOf: [] });
    for (const id of lessonIds) {
      await db.insert(lessons).values({
        id,
        moduleId: `mod_${courseId}`,
        title: `Lesson ${id}`,
        description: "d",
        estimatedDuration: "5 min",
        layers: FIVE_LAYERS,
        sourceRefs: [],
        sourceStatus: "ok",
      });
    }
  }

  it("returns a null graph (not an error) for a course with no mindMaps row yet", async () => {
    const db = await getDb(":memory:");
    await seedCourseWithLessons(db, "crs_no_map", ["lsn_a"]);

    const result = await getCourseMindMap("crs_no_map", { db });
    expect(result).toEqual({ graph: null, updatedLessonIds: [] });
  });

  it("returns the real persisted graph, with updatedLessonIds empty when no lesson has a Phase 6 update", async () => {
    const db = await getDb(":memory:");
    await seedCourseWithLessons(db, "crs_map", ["lsn_a", "lsn_b"]);
    await db.insert(mindMaps).values({
      id: "mm_1",
      courseId: "crs_map",
      graphJson: { nodes: [{ id: "lsn_a", conceptLabel: "A" }, { id: "lsn_b", conceptLabel: "B" }], edges: [] },
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await getCourseMindMap("crs_map", { db });
    expect(result.graph?.nodes).toHaveLength(2);
    expect(result.updatedLessonIds).toEqual([]);
  });

  it("flags a node's lesson as updated when a Phase 6 lessonUpdates row exists for it", async () => {
    const db = await getDb(":memory:");
    await seedCourseWithLessons(db, "crs_fresh", ["lsn_a", "lsn_b"]);
    await db.insert(mindMaps).values({
      id: "mm_2",
      courseId: "crs_fresh",
      graphJson: { nodes: [{ id: "lsn_a", conceptLabel: "A" }, { id: "lsn_b", conceptLabel: "B" }], edges: [] },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await db.insert(updateEvents).values({
      id: "ue_1",
      topicId: "crs_fresh",
      detectedAt: "2026-02-01T00:00:00.000Z",
      severity: "major",
      deltaSummary: "A core claim was reversed.",
    });
    await db.insert(lessonUpdates).values({
      id: "lu_1",
      lessonId: "lsn_a",
      updateEventId: "ue_1",
      title: "Update",
      whatChanged: "changed",
      updatedGuidance: "guidance",
      createdAt: "2026-02-01T00:00:00.000Z",
    });

    const result = await getCourseMindMap("crs_fresh", { db });
    expect(result.updatedLessonIds).toEqual(["lsn_a"]);
  });
});

describe("getMomentumStreak (Phase 9)", () => {
  beforeEach(() => resetDbCache());

  async function seedCourse(db: TeacherDb, id: string) {
    await db.insert(courses).values({ id, topic: "T", createdAt: "2026-01-01T00:00:00.000Z", volatilityTier: "medium", status: "complete" });
  }

  it("returns 0/null with no real ActivityEvents yet", async () => {
    const db = await getDb(":memory:");
    expect(await getMomentumStreak({ db })).toEqual({ currentStreakDays: 0, lastActiveDate: null });
  });

  it("computes a real streak from real ActivityEvent rows, regardless of event type", async () => {
    const db = await getDb(":memory:");
    await seedCourse(db, "crs_streak");
    const now = new Date("2026-03-10T12:00:00.000Z");
    await db.insert(activityEvents).values([
      { id: "ae_1", eventType: "lesson_viewed", entityId: "lsn_1", courseId: "crs_streak", occurredAt: now.toISOString() },
      { id: "ae_2", eventType: "quiz_completed", entityId: "lsn_1", courseId: "crs_streak", occurredAt: new Date(now.getTime() - 86_400_000).toISOString() },
    ]);

    expect(await getMomentumStreak({ db, now })).toEqual({ currentStreakDays: 2, lastActiveDate: "2026-03-10" });
  });
});

describe("getReentryOffer (Phase 9)", () => {
  beforeEach(() => resetDbCache());

  async function seedCourseWithLesson(
    db: TeacherDb,
    courseId: string,
    lessonId: string,
    knowledgeScore: number | null,
    completedAt: string | null = null
  ) {
    await db.insert(courses).values({ id: courseId, topic: "T", createdAt: "2026-01-01T00:00:00.000Z", volatilityTier: "medium", status: "complete", completedAt });
    await db.insert(modules).values({ id: `mod_${courseId}`, courseId, title: "M", description: "d", order: 0, prerequisiteOf: [] });
    await db.insert(lessons).values({
      id: lessonId,
      moduleId: `mod_${courseId}`,
      title: `Lesson ${lessonId}`,
      description: "d",
      estimatedDuration: "5 min",
      layers: FIVE_LAYERS,
      sourceRefs: [],
      sourceStatus: "ok",
    });
    if (knowledgeScore !== null) {
      await db.insert(masteryState).values({ conceptNodeId: lessonId, knowledgeScore, experienceScore: null, lastUpdated: "2026-01-02T00:00:00.000Z" });
    }
  }

  it("returns null when no in-progress lesson scores below the weak-concept threshold", async () => {
    const db = await getDb(":memory:");
    await seedCourseWithLesson(db, "crs_strong", "lsn_strong", 0.9);
    expect(await getReentryOffer({ db })).toBeNull();
  });

  it("picks the weakest-scoring lesson across in-progress courses", async () => {
    const db = await getDb(":memory:");
    await seedCourseWithLesson(db, "crs_a", "lsn_a", 0.5);
    await seedCourseWithLesson(db, "crs_b", "lsn_b", 0.2);
    const offer = await getReentryOffer({ db });
    expect(offer?.lessonId).toBe("lsn_b");
  });

  it("ignores lessons under an already-completed course", async () => {
    const db = await getDb(":memory:");
    await seedCourseWithLesson(db, "crs_done", "lsn_done", 0.1, "2026-02-01T00:00:00.000Z");
    expect(await getReentryOffer({ db })).toBeNull();
  });
});

describe("getBoredomProofingSuggestions (Phase 9)", () => {
  beforeEach(() => resetDbCache());

  async function seedPathWithCourse(db: TeacherDb, pathId: string, courseId: string) {
    await db.insert(paths).values({ id: pathId, goalDescription: `Goal ${pathId}`, createdAt: "2026-01-01T00:00:00.000Z", status: "active" });
    await db.insert(pathDomains).values({ id: `dom_${pathId}`, pathId, name: "Domain", order: 0 });
    await db.insert(courses).values({ id: courseId, topic: "T", createdAt: "2026-01-01T00:00:00.000Z", volatilityTier: "medium", status: "complete" });
    await db.insert(pathTopics).values({
      id: `pt_${pathId}`,
      pathId,
      domainId: `dom_${pathId}`,
      topicName: "Topic",
      description: "d",
      order: 0,
      parallelGroup: "tier_0",
      status: "linked_existing",
      courseId,
    });
  }

  it("returns nothing when there are no active paths at all", async () => {
    const db = await getDb(":memory:");
    expect(await getBoredomProofingSuggestions({ db })).toEqual([]);
  });

  it("flags a path whose own courses have gone quiet while another path stayed active, and leaves the active one unflagged", async () => {
    const db = await getDb(":memory:");
    await seedPathWithCourse(db, "path_quiet", "crs_quiet");
    await seedPathWithCourse(db, "path_active", "crs_active");
    const now = new Date("2026-03-10T12:00:00.000Z");

    // path_quiet's course: only OLD activity (20 days ago) — genuinely gone quiet.
    await db.insert(activityEvents).values({
      id: "ae_old",
      eventType: "lesson_viewed",
      entityId: "lsn_x",
      courseId: "crs_quiet",
      occurredAt: new Date(now.getTime() - 20 * 86_400_000).toISOString(),
    });
    // path_active's course: recent activity — this is what proves the app has been used elsewhere.
    await db.insert(activityEvents).values({
      id: "ae_recent",
      eventType: "lesson_viewed",
      entityId: "lsn_y",
      courseId: "crs_active",
      occurredAt: new Date(now.getTime() - 1 * 86_400_000).toISOString(),
    });

    const result = await getBoredomProofingSuggestions({ db, now });
    expect(result.map((r) => r.pathId)).toEqual(["path_quiet"]);
    expect(result[0]!.message.length).toBeGreaterThan(0);
  });

  it("flags nothing when the whole app has simply been idle (not this path's problem to single out)", async () => {
    const db = await getDb(":memory:");
    await seedPathWithCourse(db, "path_a", "crs_a");
    const now = new Date("2026-03-10T12:00:00.000Z");
    await db.insert(activityEvents).values({
      id: "ae_old",
      eventType: "lesson_viewed",
      entityId: "lsn_x",
      courseId: "crs_a",
      occurredAt: new Date(now.getTime() - 20 * 86_400_000).toISOString(),
    });

    expect(await getBoredomProofingSuggestions({ db, now })).toEqual([]);
  });

  it("degrades to the plain (non-diversity-biased) message rather than throwing when the diversity signal's LLM call fails", async () => {
    const db = await getDb(":memory:");
    await seedPathWithCourse(db, "path_quiet", "crs_quiet");
    // A second, completed, NOT path-linked course — this is what forces getRecentCourseDomains to
    // make a real infer_course_domain LLM call, which has no mock wired up here and will reject.
    await db.insert(courses).values({
      id: "crs_unrelated_completed",
      topic: "Unrelated",
      createdAt: "2026-01-01T00:00:00.000Z",
      volatilityTier: "medium",
      status: "complete",
      completedAt: "2026-01-05T00:00:00.000Z",
    });
    const now = new Date("2026-03-10T12:00:00.000Z");
    await db.insert(activityEvents).values({
      id: "ae_old",
      eventType: "lesson_viewed",
      entityId: "lsn_x",
      courseId: "crs_quiet",
      occurredAt: new Date(now.getTime() - 20 * 86_400_000).toISOString(),
    });
    await db.insert(activityEvents).values({
      id: "ae_recent",
      eventType: "lesson_viewed",
      entityId: "lsn_y",
      courseId: "crs_unrelated_completed",
      occurredAt: new Date(now.getTime() - 1 * 86_400_000).toISOString(),
    });

    const result = await getBoredomProofingSuggestions({ db, now });
    expect(result).toHaveLength(1);
    expect(result[0]!.pathId).toBe("path_quiet");
    expect(result[0]!.message).toContain("pick it back up");
  });
});
