import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { topoSortModules, CourseBuilderError } from "../src/courseBuilder/sequence.js";
import { buildCourse } from "../src/courseBuilder/index.js";
import { getDb, resetDbCache } from "../src/db/client.js";
import { courses, modules, lessons } from "../src/db/schema.js";
import type { SequencedModule } from "../src/courseBuilder/sequence.js";
import type { OrchestratorResult, RunOptions } from "../src/orchestrator/index.js";
import type { CourseJson, SubtopicResult } from "../src/research/types.js";

// ---------------------------------------------------------------------------
// topoSortModules — pure unit tests
// ---------------------------------------------------------------------------

function mod(tempId: string, subtopicIds: string[], prerequisiteOfTempIds: string[] = []): SequencedModule {
  return { tempId, subtopicIds, prerequisiteOfTempIds };
}

describe("topoSortModules", () => {
  it("respects a real prerequisite edge even when the model declared modules out of order", () => {
    // m3 is declared first, but m1 is a prerequisite of m3 — m1 must end up before m3.
    const ordered = topoSortModules([
      mod("m3", ["s3"]),
      mod("m1", ["s1"], ["m3"]),
      mod("m2", ["s2"]),
    ]);
    const positions = new Map(ordered.map((m, i) => [m.tempId, i]));
    expect(positions.get("m1")!).toBeLessThan(positions.get("m3")!);
  });

  it("preserves original array order for modules with no dependency relationship", () => {
    const ordered = topoSortModules([mod("a", ["s1"]), mod("b", ["s2"]), mod("c", ["s3"])]);
    expect(ordered.map((m) => m.tempId)).toEqual(["a", "b", "c"]);
  });

  it("throws CourseBuilderError on a genuine cycle", () => {
    expect(() =>
      topoSortModules([mod("a", ["s1"], ["b"]), mod("b", ["s2"], ["a"])])
    ).toThrow(CourseBuilderError);
  });

  it("ignores a self-referencing edge rather than treating it as a cycle", () => {
    const ordered = topoSortModules([mod("a", ["s1"], ["a"])]);
    expect(ordered.map((m) => m.tempId)).toEqual(["a"]);
  });

  it("ignores an edge pointing at an unknown tempId rather than crashing", () => {
    const ordered = topoSortModules([mod("a", ["s1"], ["does-not-exist"])]);
    expect(ordered.map((m) => m.tempId)).toEqual(["a"]);
  });
});

// ---------------------------------------------------------------------------
// buildCourse — integration tests against an in-memory SQLite db
// ---------------------------------------------------------------------------

function makeSubtopic(id: string, title: string): SubtopicResult {
  const layer = (label: string) => ({ text: `${label} content for ${title}`, source_ids: ["src_1"] });
  return {
    id,
    title,
    description: `Description for ${title}`,
    sources: [],
    keyPoints: [{ point: `Key point for ${title}`, source_id: "src_1" }],
    synthesis: {
      claims: [{ text: "A claim", source_ids: ["src_1"], addressesContention: false }],
      contentionNotes: [],
    },
    layers: {
      intuition: layer("intuition"),
      mechanics: layer("mechanics"),
      formal: layer("formal"),
      application: layer("application"),
      frontier: layer("frontier"),
    },
    auditPasses: [{ attempt: 1, criteria: {} as never, overallPass: true }],
    auditStatus: "passed",
    volatility: { tier: "medium", justification: "test" },
  };
}

function makeCourseJson(): CourseJson {
  return {
    topic: "Test Topic",
    prerequisites: ["Basic algebra"],
    subtopics: [makeSubtopic("sub-a", "Subtopic A"), makeSubtopic("sub-b", "Subtopic B"), makeSubtopic("sub-c", "Subtopic C")],
    generatedAt: new Date().toISOString(),
    coverageStatus: "complete",
  };
}

/**
 * Mock orchestrator.run() covering only what buildCourse() calls: sequence_modules
 * and write_lesson_metadata. Deliberately returns modules out of order (c, a, b)
 * with a declared to be a prerequisite of c, so persistence tests can assert the
 * code-side topological sort — not the model's own array order — decided the order.
 */
function makeCourseBuilderMock(): (
  taskType: string,
  context: Record<string, unknown>,
  callingModule: string,
  options?: RunOptions
) => Promise<OrchestratorResult<unknown>> {
  return async (taskType, context) => {
    const respond = (data: unknown): OrchestratorResult<unknown> => ({
      taskType,
      promptVersion: "test",
      data,
      attempts: 1,
      raw: JSON.stringify(data),
    });

    if (taskType === "sequence_modules") {
      return respond({
        modules: [
          { tempId: "mc", subtopicIds: ["sub-c"], prerequisiteOfTempIds: [] },
          { tempId: "ma", subtopicIds: ["sub-a"], prerequisiteOfTempIds: ["mc"] },
          { tempId: "mb", subtopicIds: ["sub-b"], prerequisiteOfTempIds: [] },
        ],
      });
    }

    if (taskType === "write_lesson_metadata") {
      const modulesCtx = context.modules as Array<{ tempId: string; subtopics: Array<{ id: string; title: string }> }>;
      return respond({
        modules: modulesCtx.map((m) => ({ tempId: m.tempId, title: `Module ${m.tempId}`, description: "d" })),
        lessons: modulesCtx.flatMap((m) =>
          m.subtopics.map((s) => ({ subtopicId: s.id, title: `Lesson: ${s.title}`, description: "d", estimatedDuration: "5 min" }))
        ),
      });
    }

    throw new Error(`No mock for task type "${taskType}"`);
  };
}

describe("buildCourse", () => {
  it("persists Course/Module/Lesson records with module order reflecting the real prerequisite chain, not declaration order", async () => {
    resetDbCache();
    const db = await getDb(":memory:");
    const course = makeCourseJson();
    const memoryGraphCalls: Array<{ courseId: string; topic: string; prerequisites: string[] }> = [];

    const result = await buildCourse(course, {
      orchestratorRun: makeCourseBuilderMock() as never,
      db,
      writeTopicToMemoryGraph: async (courseId, topic, prerequisites) => {
        memoryGraphCalls.push({ courseId, topic, prerequisites });
      },
    });

    expect(result.moduleCount).toBe(3);
    expect(result.lessonCount).toBe(3);
    expect(Object.keys(result.subtopicLessonMap).sort()).toEqual(["sub-a", "sub-b", "sub-c"]);

    const persistedCourse = await db.select().from(courses).where(eq(courses.id, result.courseId));
    expect(persistedCourse).toHaveLength(1);
    expect(persistedCourse[0]!.status).toBe("building");
    expect(persistedCourse[0]!.volatilityTier).toBe("medium");

    const persistedModules = await db.select().from(modules).where(eq(modules.courseId, result.courseId));
    const moduleA = persistedModules.find((m) => m.title === "Module ma")!;
    const moduleC = persistedModules.find((m) => m.title === "Module mc")!;

    // The model declared [mc, ma, mb], but ma is a prerequisite of mc — persisted order must put ma first.
    expect(moduleA.order).toBeLessThan(moduleC.order);
    expect(moduleC.prerequisiteOf).toEqual([]);
    expect(moduleA.prerequisiteOf).toEqual([moduleC.id]);

    const persistedLessons = await db.select().from(lessons);
    expect(persistedLessons).toHaveLength(3);
    for (const lesson of persistedLessons) {
      expect(lesson.sourceRefs).toEqual([]);
      expect(lesson.sourceStatus).toBe("ok");
      expect(lesson.layers.intuition.text).toContain("intuition content for");
    }

    expect(memoryGraphCalls).toEqual([
      { courseId: result.courseId, topic: "Test Topic", prerequisites: ["Basic algebra"] },
    ]);
  });

  it("mints distinct ids across two builds of similarly-titled courses against the same db (no UNIQUE collision)", async () => {
    resetDbCache();
    const db = await getDb(":memory:");
    const course = makeCourseJson();

    const first = await buildCourse(course, { orchestratorRun: makeCourseBuilderMock() as never, db, writeTopicToMemoryGraph: async () => {} });
    const second = await buildCourse(course, { orchestratorRun: makeCourseBuilderMock() as never, db, writeTopicToMemoryGraph: async () => {} });

    expect(first.courseId).not.toBe(second.courseId);
    const allCourses = await db.select().from(courses);
    expect(allCourses).toHaveLength(2);
    const allModules = await db.select().from(modules);
    expect(allModules).toHaveLength(6);
    const allLessons = await db.select().from(lessons);
    expect(allLessons).toHaveLength(6);
  });
});
