import { describe, it, expect, beforeEach } from "vitest";
import {
  getDashboardCourses,
  getCompletedCourses,
  getActivePathsWithProgress,
  getLessonWithSources,
  getCourseMindMap,
} from "../src/db/queries.js";
import { getDb, resetDbCache } from "../src/db/client.js";
import { courses, modules, lessons, sources, paths, pathDomains, pathTopics, mindMaps, updateEvents, lessonUpdates } from "../src/db/schema.js";
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
      sourceRefs: ["src_ls_1"],
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
