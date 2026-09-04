import { describe, it, expect, beforeEach } from "vitest";
import {
  answerLessonQuestion,
  TeachingEngineError,
} from "../src/teachingEngine/answerLessonQuestion.js";
import { getDb, resetDbCache } from "../src/db/client.js";
import { courses, modules, lessons, sources } from "../src/db/schema.js";
import type { TeacherDb } from "../src/db/client.js";
import type { OrchestratorResult, RunOptions } from "../src/orchestrator/index.js";

type MockRun = (
  taskType: string,
  context: Record<string, unknown>,
  callingModule: string,
  options?: RunOptions
) => Promise<OrchestratorResult<unknown>>;

async function seedLessonWithSources(
  db: TeacherDb
): Promise<{ lessonId: string; sourceId1: string; sourceId2: string }> {
  const courseId = "crs_teach_test";
  const moduleId = "mod_teach_test";
  const lessonId = "lsn_teach_test";
  const sourceId1 = "src_teach_1";
  const sourceId2 = "src_teach_2";

  await db.insert(courses).values({ id: courseId, topic: "Thermodynamics", createdAt: new Date().toISOString(), volatilityTier: "medium", status: "complete" });
  await db.insert(modules).values({ id: moduleId, courseId, title: "M", description: "d", order: 0, prerequisiteOf: [] });
  await db.insert(sources).values([
    { id: sourceId1, url: "https://example.com/1", type: "article", extractedText: "Entropy always increases in an isolated system.", credibilityScore: 0.9, fetchedAt: new Date().toISOString() },
    { id: sourceId2, url: "https://example.com/2", type: "article", extractedText: "The second law of thermodynamics governs heat flow direction.", credibilityScore: 0.9, fetchedAt: new Date().toISOString() },
  ]);
  await db.insert(lessons).values({
    id: lessonId,
    moduleId,
    title: "The Second Law",
    description: "Entropy and the arrow of time.",
    estimatedDuration: "10 min",
    layers: {
      intuition: { text: "Things naturally become more disordered over time.", source_ids: [sourceId1] },
      mechanics: { text: "Entropy is a measure of disorder that never decreases in an isolated system.", source_ids: [sourceId1] },
      formal: { text: "dS >= 0 for an isolated system.", source_ids: [sourceId1] },
      application: { text: "This is why heat flows from hot to cold, not the reverse.", source_ids: [sourceId2] },
      frontier: { text: "Open questions remain about entropy at the quantum scale.", source_ids: [] },
    },
    sourceRefs: [sourceId1, sourceId2],
    sourceStatus: "ok",
  });
  return { lessonId, sourceId1, sourceId2 };
}

describe("answerLessonQuestion", () => {
  beforeEach(() => resetDbCache());

  it("throws TeachingEngineError for an unknown lesson id", async () => {
    const db = await getDb(":memory:");
    await expect(
      answerLessonQuestion("does-not-exist", "What is entropy?", { db, orchestratorRun: (async () => {
        throw new Error("should not be called");
      }) as never })
    ).rejects.toThrow(TeachingEngineError);
  });

  it("grounds the call in the lesson's real layers and its real linked sources", async () => {
    const db = await getDb(":memory:");
    const { lessonId, sourceId1, sourceId2 } = await seedLessonWithSources(db);

    let capturedContext: Record<string, unknown> | undefined;
    const mock: MockRun = async (taskType, context) => {
      capturedContext = context;
      return {
        taskType,
        promptVersion: "test",
        data: { answer: "Entropy never decreases in an isolated system.", sourceIds: [sourceId1], outsideLessonScope: false },
        attempts: 1,
        raw: "{}",
      };
    };

    const result = await answerLessonQuestion(lessonId, "What is entropy?", { db, orchestratorRun: mock as never });

    expect(capturedContext?.lessonTitle).toBe("The Second Law");
    expect(capturedContext?.layers).toMatchObject({ intuition: expect.stringContaining("disordered") });
    const sourcesCtx = capturedContext?.sources as Array<{ source_id: string }>;
    expect(new Set(sourcesCtx.map((s) => s.source_id))).toEqual(new Set([sourceId1, sourceId2]));

    expect(result.lessonId).toBe(lessonId);
    expect(result.answer).toContain("Entropy");
    expect(result.sourceIds).toEqual([sourceId1]);
    expect(result.outsideLessonScope).toBe(false);
  });

  it("wires validateExtra with exactly the lesson's real source_id set, rejecting a fabricated one and accepting a real one", async () => {
    const db = await getDb(":memory:");
    const { lessonId, sourceId1 } = await seedLessonWithSources(db);

    let capturedValidateExtra: RunOptions["validateExtra"];
    const mock: MockRun = async (taskType, _context, _module, options) => {
      capturedValidateExtra = options?.validateExtra;
      return {
        taskType,
        promptVersion: "test",
        data: { answer: "a", sourceIds: [sourceId1], outsideLessonScope: false },
        attempts: 1,
        raw: "{}",
      };
    };

    await answerLessonQuestion(lessonId, "q", { db, orchestratorRun: mock as never });

    expect(capturedValidateExtra).toBeDefined();
    expect(
      capturedValidateExtra!({ answer: "a", sourceIds: ["src_fabricated"], outsideLessonScope: false })
    ).toMatchObject({ success: false });
    expect(
      capturedValidateExtra!({ answer: "a", sourceIds: [sourceId1], outsideLessonScope: false })
    ).toEqual({ success: true });
  });

  it("passes through outsideLessonScope: true honestly when the model says the lesson doesn't cover it", async () => {
    const db = await getDb(":memory:");
    const { lessonId } = await seedLessonWithSources(db);

    const mock: MockRun = async (taskType) => ({
      taskType,
      promptVersion: "test",
      data: { answer: "This lesson doesn't cover that.", sourceIds: [], outsideLessonScope: true },
      attempts: 1,
      raw: "{}",
    });

    const result = await answerLessonQuestion(lessonId, "What's the capital of France?", { db, orchestratorRun: mock as never });
    expect(result.outsideLessonScope).toBe(true);
  });

  it("records a real lesson_question_asked ActivityEvent scoped to the lesson's real course (Phase 9)", async () => {
    const db = await getDb(":memory:");
    const { lessonId } = await seedLessonWithSources(db);

    const mock: MockRun = async (taskType) => ({
      taskType,
      promptVersion: "test",
      data: { answer: "a", sourceIds: [], outsideLessonScope: false },
      attempts: 1,
      raw: "{}",
    });

    const calls: Array<{ eventType: string; entityId: string; courseId: string }> = [];
    await answerLessonQuestion(lessonId, "q", {
      db,
      orchestratorRun: mock as never,
      recordActivityEvent: async (eventType, entityId, courseId) => {
        calls.push({ eventType, entityId, courseId });
      },
    });

    expect(calls).toEqual([{ eventType: "lesson_question_asked", entityId: lessonId, courseId: "crs_teach_test" }]);
  });
});
