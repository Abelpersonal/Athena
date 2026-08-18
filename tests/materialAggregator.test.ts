import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { buildCourse } from "../src/courseBuilder/index.js";
import { aggregateMaterials } from "../src/materialAggregator/index.js";
import { getDb, resetDbCache } from "../src/db/client.js";
import { lessons, sources } from "../src/db/schema.js";
import type { TeacherDb } from "../src/db/client.js";
import type { OrchestratorResult, RunOptions } from "../src/orchestrator/index.js";
import type { CourseJson, SourceRecord, SubtopicResult } from "../src/research/types.js";
import type { CleanedContent } from "../src/extraction/fetchAndClean.js";
import type { BackfillSubtopicInput } from "../src/research/pipeline.js";

function makeSource(id: string, url: string): SourceRecord {
  return {
    source_id: id,
    url,
    title: `Title for ${url}`,
    text: "x".repeat(500),
    extractionConfidence: 0.8,
    domain: "example.com",
    query: "test query",
    role: "initial",
  };
}

function makeSubtopic(id: string, title: string, sourceRecords: SourceRecord[]): SubtopicResult {
  const layer = (label: string) => ({ text: `${label} content`, source_ids: sourceRecords.map((s) => s.source_id) });
  return {
    id,
    title,
    description: `Description for ${title}`,
    sources: sourceRecords,
    keyPoints: sourceRecords.map((s, i) => ({ point: `Key point ${i} for ${title}`, source_id: s.source_id })),
    synthesis: { claims: [{ text: "claim", source_ids: [sourceRecords[0]!.source_id], addressesContention: false }], contentionNotes: [] },
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

async function seedCourse(db: TeacherDb, course: CourseJson) {
  const mockRun = async (
    taskType: string,
    context: Record<string, unknown>
  ): Promise<OrchestratorResult<unknown>> => {
    const respond = (data: unknown): OrchestratorResult<unknown> => ({
      taskType,
      promptVersion: "test",
      data,
      attempts: 1,
      raw: JSON.stringify(data),
    });
    if (taskType === "sequence_modules") {
      return respond({
        modules: course.subtopics.map((s, i) => ({ tempId: `m${i}`, subtopicIds: [s.id], prerequisiteOfTempIds: [] })),
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

  return buildCourse(course, { orchestratorRun: mockRun as never, db, writeTopicToMemoryGraph: async () => {} });
}

function fetchAndCleanReturning(byUrl: Record<string, CleanedContent>): (url: string) => Promise<CleanedContent> {
  return async (url: string) => byUrl[url] ?? { text: "", title: "", extractionConfidence: 0, sourceType: "unreachable" };
}

describe("aggregateMaterials", () => {
  it("persists Source rows and links them to the right lesson via sourceRefs", async () => {
    resetDbCache();
    const db = await getDb(":memory:");
    const srcA = makeSource("src_a1", "https://example.com/a1");
    const srcB = makeSource("src_a2", "https://example.com/a2");
    const course: CourseJson = {
      topic: "Topic",
      prerequisites: [],
      subtopics: [makeSubtopic("sub-a", "Subtopic A", [srcA, srcB])],
      generatedAt: new Date().toISOString(),
    };
    const built = await seedCourse(db, course);

    const result = await aggregateMaterials(built.courseId, course, built.subtopicLessonMap, {
      db,
      fetchAndClean: fetchAndCleanReturning({
        "https://example.com/a1": { text: "real article text", title: "A1", extractionConfidence: 0.9, sourceType: "article" },
        "https://example.com/a2": { text: "real article text", title: "A2", extractionConfidence: 0.9, sourceType: "article" },
      }),
      backfillSubtopic: async () => {
        throw new Error("backfill should not be called — 2 valid sources already meets the default threshold");
      },
      writeSubtopicFacts: async () => {},
    });

    expect(result.sourceCount).toBe(2);
    expect(result.backfillTriggeredCount).toBe(0);
    expect(result.belowThresholdLessonCount).toBe(0);

    const persistedSources = await db.select().from(sources);
    expect(persistedSources).toHaveLength(2);
    expect(persistedSources.map((s) => s.type)).toEqual(["article", "article"]);

    const lessonId = built.subtopicLessonMap["sub-a"]!;
    const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId));
    expect(lesson!.sourceRefs.sort()).toEqual(["src_a1", "src_a2"]);
    expect(lesson!.sourceStatus).toBe("ok");
  });

  it("triggers exactly one targeted backfill when a lesson lands below the valid-source threshold, and recovers above it", async () => {
    resetDbCache();
    const db = await getDb(":memory:");
    const srcA = makeSource("src_b1", "https://example.com/b1");
    const course: CourseJson = {
      topic: "Topic",
      prerequisites: [],
      subtopics: [makeSubtopic("sub-b", "Subtopic B", [srcA])],
      generatedAt: new Date().toISOString(),
    };
    const built = await seedCourse(db, course);

    let backfillCalls = 0;
    let capturedInput: BackfillSubtopicInput | undefined;

    const result = await aggregateMaterials(built.courseId, course, built.subtopicLessonMap, {
      db,
      minValidSources: 2,
      fetchAndClean: fetchAndCleanReturning({
        // The one original source turns out unreachable on re-fetch — 0 valid sources.
        "https://example.com/b1": { text: "", title: "", extractionConfidence: 0, sourceType: "unreachable" },
      }),
      backfillSubtopic: async (input) => {
        backfillCalls += 1;
        capturedInput = input;
        return [makeSource("src_backfill_1", "https://example.com/backfill1"), makeSource("src_backfill_2", "https://example.com/backfill2")];
      },
      writeSubtopicFacts: async () => {},
    });

    expect(backfillCalls).toBe(1);
    expect(capturedInput?.subtopicTitle).toBe("Subtopic B");
    expect(capturedInput?.gapInstruction).toMatch(/0 valid source/);
    expect(result.backfillTriggeredCount).toBe(1);
    expect(result.belowThresholdLessonCount).toBe(0); // recovered: 2 backfilled sources meet the threshold

    const lessonId = built.subtopicLessonMap["sub-b"]!;
    const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId));
    expect(lesson!.sourceStatus).toBe("ok");
    expect(lesson!.sourceRefs).toContain("src_backfill_1");
    expect(lesson!.sourceRefs).toContain("src_backfill_2");
  });

  it("flags a lesson source_status: below_threshold when it is still short after the one backfill attempt", async () => {
    resetDbCache();
    const db = await getDb(":memory:");
    const srcA = makeSource("src_c1", "https://example.com/c1");
    const course: CourseJson = {
      topic: "Topic",
      prerequisites: [],
      subtopics: [makeSubtopic("sub-c", "Subtopic C", [srcA])],
      generatedAt: new Date().toISOString(),
    };
    const built = await seedCourse(db, course);

    let backfillCalls = 0;
    const result = await aggregateMaterials(built.courseId, course, built.subtopicLessonMap, {
      db,
      minValidSources: 2,
      fetchAndClean: fetchAndCleanReturning({
        "https://example.com/c1": { text: "", title: "", extractionConfidence: 0, sourceType: "unreachable" },
      }),
      backfillSubtopic: async () => {
        backfillCalls += 1;
        return []; // backfill genuinely found nothing usable
      },
      writeSubtopicFacts: async () => {},
    });

    expect(backfillCalls).toBe(1); // exactly one attempt, no looping
    expect(result.belowThresholdLessonCount).toBe(1);

    const lessonId = built.subtopicLessonMap["sub-c"]!;
    const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId));
    expect(lesson!.sourceStatus).toBe("below_threshold");
  });

  it("marks the course status complete after aggregation finishes", async () => {
    resetDbCache();
    const db = await getDb(":memory:");
    const course: CourseJson = {
      topic: "Topic",
      prerequisites: [],
      subtopics: [makeSubtopic("sub-d", "Subtopic D", [makeSource("src_d1", "https://example.com/d1"), makeSource("src_d2", "https://example.com/d2")])],
      generatedAt: new Date().toISOString(),
    };
    const built = await seedCourse(db, course);

    await aggregateMaterials(built.courseId, course, built.subtopicLessonMap, {
      db,
      fetchAndClean: fetchAndCleanReturning({
        "https://example.com/d1": { text: "t", title: "t", extractionConfidence: 0.9, sourceType: "article" },
        "https://example.com/d2": { text: "t", title: "t", extractionConfidence: 0.9, sourceType: "article" },
      }),
      backfillSubtopic: async () => [],
      writeSubtopicFacts: async () => {},
    });

    const { courses } = await import("../src/db/schema.js");
    const [persisted] = await db.select().from(courses).where(eq(courses.id, built.courseId));
    expect(persisted!.status).toBe("complete");
  });

  it("does not crash when two subtopics cite the exact same URL (idempotent Source insert)", async () => {
    resetDbCache();
    const db = await getDb(":memory:");
    const sharedUrl = "https://example.com/shared";
    const sharedSourceInSubA = makeSource("src_shared", sharedUrl);
    const sharedSourceInSubB = makeSource("src_shared", sharedUrl); // same content-hashed id, same url
    const course: CourseJson = {
      topic: "Topic",
      prerequisites: [],
      subtopics: [
        makeSubtopic("sub-e", "Subtopic E", [sharedSourceInSubA, makeSource("src_e2", "https://example.com/e2")]),
        makeSubtopic("sub-f", "Subtopic F", [sharedSourceInSubB, makeSource("src_f2", "https://example.com/f2")]),
      ],
      generatedAt: new Date().toISOString(),
    };
    const built = await seedCourse(db, course);

    const result = await aggregateMaterials(built.courseId, course, built.subtopicLessonMap, {
      db,
      fetchAndClean: fetchAndCleanReturning({
        [sharedUrl]: { text: "t", title: "t", extractionConfidence: 0.9, sourceType: "article" },
        "https://example.com/e2": { text: "t", title: "t", extractionConfidence: 0.9, sourceType: "article" },
        "https://example.com/f2": { text: "t", title: "t", extractionConfidence: 0.9, sourceType: "article" },
      }),
      backfillSubtopic: async () => {
        throw new Error("should not be called — every subtopic has 2 valid sources");
      },
      writeSubtopicFacts: async () => {},
    });

    expect(result.sourceCount).toBe(4); // 2 sourceRefs per lesson, even though src_shared is one physical row
    const persistedSources = await db.select().from(sources);
    expect(persistedSources).toHaveLength(3); // src_shared, src_e2, src_f2 — no duplicate row for the shared url
  });

  it("calls writeSubtopicFacts once per subtopic with its keyPoints, courseId, and subtopicId", async () => {
    resetDbCache();
    const db = await getDb(":memory:");
    const src = makeSource("src_g1", "https://example.com/g1");
    const course: CourseJson = {
      topic: "Topic",
      prerequisites: [],
      subtopics: [makeSubtopic("sub-g", "Subtopic G", [src, makeSource("src_g2", "https://example.com/g2")])],
      generatedAt: new Date().toISOString(),
    };
    const built = await seedCourse(db, course);

    const calls: Array<{ courseId: string; subtopicId: string; keyPoints: unknown }> = [];
    await aggregateMaterials(built.courseId, course, built.subtopicLessonMap, {
      db,
      fetchAndClean: fetchAndCleanReturning({
        "https://example.com/g1": { text: "t", title: "t", extractionConfidence: 0.9, sourceType: "article" },
        "https://example.com/g2": { text: "t", title: "t", extractionConfidence: 0.9, sourceType: "article" },
      }),
      backfillSubtopic: async () => {
        throw new Error("should not be called");
      },
      writeSubtopicFacts: async (courseId, subtopicId, keyPoints) => {
        calls.push({ courseId, subtopicId, keyPoints });
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.courseId).toBe(built.courseId);
    expect(calls[0]!.subtopicId).toBe("sub-g");
    expect(calls[0]!.keyPoints).toEqual(course.subtopics[0]!.keyPoints);
  });
});
