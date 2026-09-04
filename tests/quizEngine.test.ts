import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  generateQuizQuestions,
  scoreAndRecordQuiz,
  checkAndMarkCourseCompletion,
  isTransferHighScoreAchieved,
  QuizEngineError,
  ALL_QUIZ_TIERS,
  type QuizQuestion,
  type QuizAnswer,
} from "../src/quizEngine/index.js";
import { getDb, resetDbCache } from "../src/db/client.js";
import { courses, modules, lessons, quizResults, masteryState, activityEvents } from "../src/db/schema.js";
import type { TeacherDb } from "../src/db/client.js";
import type { OrchestratorResult, RunOptions } from "../src/orchestrator/index.js";

async function seedLesson(db: TeacherDb): Promise<{ lessonId: string; moduleId: string; courseId: string }> {
  const courseId = "crs_test";
  const moduleId = "mod_test";
  const lessonId = "lsn_test";
  await db
    .insert(courses)
    .values({ id: courseId, topic: "Test Topic", createdAt: new Date().toISOString(), volatilityTier: "medium", status: "complete" });
  await db.insert(modules).values({ id: moduleId, courseId, title: "Test Module", description: "d", order: 0, prerequisiteOf: [] });
  await db.insert(lessons).values({
    id: lessonId,
    moduleId,
    title: "Newton's Laws",
    description: "An introduction to Newton's three laws of motion.",
    estimatedDuration: "10 min",
    layers: {
      intuition: { text: "Objects resist changes to their motion — that's inertia.", source_ids: [] },
      mechanics: { text: "F = ma relates net force, mass, and acceleration.", source_ids: [] },
      formal: { text: "Formal statement of the three laws of motion.", source_ids: [] },
      application: { text: "Used to compute rocket trajectories and car crash forces.", source_ids: [] },
      frontier: { text: "Breaks down at relativistic speeds — General Relativity takes over.", source_ids: [] },
    },
    sourceRefs: [],
    sourceStatus: "ok",
  });
  return { lessonId, moduleId, courseId };
}

type MockRun = (
  taskType: string,
  context: Record<string, unknown>,
  callingModule: string,
  options?: RunOptions
) => Promise<OrchestratorResult<unknown>>;

function respond(taskType: string, data: unknown): OrchestratorResult<unknown> {
  return { taskType, promptVersion: "test", data, attempts: 1, raw: JSON.stringify(data) };
}

/** One multiple_choice + one free_text question per tier call, tagged distinctly per taskType so tests can tell tiers apart. */
function makeQuestionGenMock(): MockRun {
  return async (taskType) => {
    if (taskType.startsWith("generate_") && taskType.endsWith("_questions")) {
      return respond(taskType, {
        questions: [
          {
            type: "multiple_choice",
            prompt: `[${taskType}] MC question`,
            options: ["wrong A", "correct", "wrong B"],
            correctOptionIndex: 1,
          },
          {
            type: "free_text",
            prompt: `[${taskType}] Free-text question`,
            rubric: "Must mention inertia.",
          },
        ],
      });
    }
    throw new Error(`No mock for task type "${taskType}"`);
  };
}

describe("generateQuizQuestions", () => {
  beforeEach(() => {
    resetDbCache();
  });

  it("generates tier-tagged questions for all three tiers by default, grounded in the lesson", async () => {
    const db = await getDb(":memory:");
    const { lessonId } = await seedLesson(db);

    const calls: Array<{ taskType: string; context: Record<string, unknown> }> = [];
    const mock: MockRun = async (taskType, context) => {
      calls.push({ taskType, context });
      return makeQuestionGenMock()(taskType, context, "test");
    };

    const questions = await generateQuizQuestions(lessonId, ALL_QUIZ_TIERS, { db, orchestratorRun: mock as never });

    expect(questions).toHaveLength(6); // 2 questions x 3 tiers
    expect(new Set(questions.map((q) => q.tier))).toEqual(new Set(["recall", "application", "transfer"]));
    expect(new Set(questions.map((q) => q.id)).size).toBe(6); // unique ids

    expect(calls.map((c) => c.taskType).sort()).toEqual(
      ["generate_application_questions", "generate_recall_questions", "generate_transfer_questions"].sort()
    );
    // Grounded in the lesson's real persisted content, not a generic prompt.
    for (const call of calls) {
      expect(call.context.lessonTitle).toBe("Newton's Laws");
      expect(call.context.layers).toBeDefined();
    }
  });

  it("only requests the tiers actually passed in", async () => {
    const db = await getDb(":memory:");
    const { lessonId } = await seedLesson(db);
    const calls: string[] = [];
    const mock: MockRun = async (taskType, context) => {
      calls.push(taskType);
      return makeQuestionGenMock()(taskType, context, "test");
    };

    await generateQuizQuestions(lessonId, ["recall"], { db, orchestratorRun: mock as never });
    expect(calls).toEqual(["generate_recall_questions"]);
  });

  it("produces the correct shape for each question type", async () => {
    const db = await getDb(":memory:");
    const { lessonId } = await seedLesson(db);
    const questions = await generateQuizQuestions(lessonId, ["recall"], {
      db,
      orchestratorRun: makeQuestionGenMock() as never,
    });

    const mc = questions.find((q) => q.type === "multiple_choice")!;
    expect(mc.options).toEqual(["wrong A", "correct", "wrong B"]);
    expect(mc.correctOptionIndex).toBe(1);

    const ft = questions.find((q) => q.type === "free_text")!;
    expect(ft.rubric).toBe("Must mention inertia.");
  });

  it("throws QuizEngineError for an unknown lesson id", async () => {
    const db = await getDb(":memory:");
    await expect(
      generateQuizQuestions("does-not-exist", ["recall"], { db, orchestratorRun: makeQuestionGenMock() as never })
    ).rejects.toThrow(QuizEngineError);
  });
});

describe("scoreAndRecordQuiz", () => {
  beforeEach(() => {
    resetDbCache();
  });

  function makeQuestions(_lessonId: string): QuizQuestion[] {
    return [
      { id: "q-mc-correct", tier: "recall", type: "multiple_choice", prompt: "MC 1", options: ["a", "b"], correctOptionIndex: 1 },
      { id: "q-mc-wrong", tier: "recall", type: "multiple_choice", prompt: "MC 2", options: ["a", "b"], correctOptionIndex: 0 },
      { id: "q-ft-good", tier: "application", type: "free_text", prompt: "FT good", rubric: "r" },
      { id: "q-ft-bad", tier: "application", type: "free_text", prompt: "FT bad", rubric: "r" },
    ];
  }

  /** Known-good answer scores 0.9, known-bad answer scores 0.1 — proves free-text scoring is threaded through, not hardcoded. */
  function makeScoringMock(): MockRun {
    return async (taskType, context) => {
      if (taskType === "score_free_text_answer") {
        const isGood = context.userAnswer === "a genuinely correct explanation";
        return respond(taskType, { score: isGood ? 0.9 : 0.1, explanation: isGood ? "Correct." : "Incorrect." });
      }
      throw new Error(`No mock for task type "${taskType}"`);
    };
  }

  it("scores multiple_choice questions in code (no LLM call) and free_text questions via the semantic scorer", async () => {
    const db = await getDb(":memory:");
    const { lessonId } = await seedLesson(db);
    const questions = makeQuestions(lessonId);
    const answers: QuizAnswer[] = [
      { questionId: "q-mc-correct", answer: 1 },
      { questionId: "q-mc-wrong", answer: 1 }, // wrong: correct index is 0
      { questionId: "q-ft-good", answer: "a genuinely correct explanation" },
      { questionId: "q-ft-bad", answer: "nonsense" },
    ];

    const calls: string[] = [];
    const mock: MockRun = async (taskType, context) => {
      calls.push(taskType);
      return makeScoringMock()(taskType, context, "test");
    };

    const result = await scoreAndRecordQuiz(lessonId, questions, answers, {
      db,
      orchestratorRun: mock as never,
      writeMasteryUpdate: async () => {},
    });

    // Only the two free_text questions should have triggered an LLM call.
    expect(calls).toEqual(["score_free_text_answer", "score_free_text_answer"]);

    const byId = new Map(result.questionResults.map((r) => [r.questionId, r.score]));
    expect(byId.get("q-mc-correct")).toBe(1);
    expect(byId.get("q-mc-wrong")).toBe(0);
    expect(byId.get("q-ft-good")).toBeCloseTo(0.9);
    expect(byId.get("q-ft-bad")).toBeCloseTo(0.1);

    expect(result.tierScores.recall).toBeCloseTo((1 + 0) / 2);
    expect(result.tierScores.application).toBeCloseTo((0.9 + 0.1) / 2);
    expect(result.overallScore).toBeCloseTo((1 + 0 + 0.9 + 0.1) / 4);
  });

  it("persists one QuizResult row per tier tested", async () => {
    const db = await getDb(":memory:");
    const { lessonId } = await seedLesson(db);
    const questions = makeQuestions(lessonId);
    const answers: QuizAnswer[] = [
      { questionId: "q-mc-correct", answer: 1 },
      { questionId: "q-mc-wrong", answer: 0 },
      { questionId: "q-ft-good", answer: "a genuinely correct explanation" },
      { questionId: "q-ft-bad", answer: "nonsense" },
    ];

    await scoreAndRecordQuiz(lessonId, questions, answers, {
      db,
      orchestratorRun: makeScoringMock() as never,
      writeMasteryUpdate: async () => {},
    });

    const rows = await db.select().from(quizResults).where(eq(quizResults.lessonId, lessonId));
    expect(rows).toHaveLength(2); // recall + application
    expect(new Set(rows.map((r) => r.tier))).toEqual(new Set(["recall", "application"]));
  });

  it("upserts MasteryState.knowledgeScore without touching an existing experienceScore", async () => {
    const db = await getDb(":memory:");
    const { lessonId } = await seedLesson(db);
    await db.insert(masteryState).values({
      conceptNodeId: lessonId,
      knowledgeScore: null,
      experienceScore: 0.73,
      lastUpdated: "2020-01-01T00:00:00.000Z",
    });

    const questions = makeQuestions(lessonId);
    const answers: QuizAnswer[] = [
      { questionId: "q-mc-correct", answer: 1 }, // correct (correctOptionIndex 1) -> 1
      { questionId: "q-mc-wrong", answer: 0 }, // correct (correctOptionIndex 0) -> 1
      { questionId: "q-ft-good", answer: "a genuinely correct explanation" }, // -> 0.9
      { questionId: "q-ft-bad", answer: "a genuinely correct explanation" }, // -> 0.9
    ];

    const result = await scoreAndRecordQuiz(lessonId, questions, answers, {
      db,
      orchestratorRun: makeScoringMock() as never,
      writeMasteryUpdate: async () => {},
    });

    expect(result.masteryState.knowledgeScore).toBeCloseTo((1 + 1 + 0.9 + 0.9) / 4);
    expect(result.masteryState.experienceScore).toBeCloseTo(0.73); // untouched by a quiz run

    const [row] = await db.select().from(masteryState).where(eq(masteryState.conceptNodeId, lessonId));
    expect(row!.experienceScore).toBeCloseTo(0.73);
  });

  it("surfaces the lesson as a weak concept node when the overall score falls below the threshold, and not otherwise", async () => {
    const db1 = await getDb(":memory:");
    const { lessonId: lessonId1 } = await seedLesson(db1);
    const lowScoreAnswers: QuizAnswer[] = [
      { questionId: "q-mc-correct", answer: 0 }, // wrong
      { questionId: "q-mc-wrong", answer: 1 }, // wrong
      { questionId: "q-ft-good", answer: "nonsense" },
      { questionId: "q-ft-bad", answer: "nonsense" },
    ];
    const lowResult = await scoreAndRecordQuiz(lessonId1, makeQuestions(lessonId1), lowScoreAnswers, {
      db: db1,
      orchestratorRun: makeScoringMock() as never,
      writeMasteryUpdate: async () => {},
      weakConceptThreshold: 0.6,
    });
    expect(lowResult.overallScore).toBeLessThan(0.6);
    expect(lowResult.weakConceptNodes).toEqual([lessonId1]);

    resetDbCache();
    const db2 = await getDb(":memory:");
    const { lessonId: lessonId2 } = await seedLesson(db2);
    const highScoreAnswers: QuizAnswer[] = [
      { questionId: "q-mc-correct", answer: 1 },
      { questionId: "q-mc-wrong", answer: 0 },
      { questionId: "q-ft-good", answer: "a genuinely correct explanation" },
      { questionId: "q-ft-bad", answer: "a genuinely correct explanation" },
    ];
    const highResult = await scoreAndRecordQuiz(lessonId2, makeQuestions(lessonId2), highScoreAnswers, {
      db: db2,
      orchestratorRun: makeScoringMock() as never,
      writeMasteryUpdate: async () => {},
      weakConceptThreshold: 0.6,
    });
    expect(highResult.overallScore).toBeGreaterThanOrEqual(0.6);
    expect(highResult.weakConceptNodes).toEqual([]);
  });

  it("mirrors the knowledge update into the Memory Graph with the lesson id and 'knowledge' type", async () => {
    const db = await getDb(":memory:");
    const { lessonId } = await seedLesson(db);
    const calls: Array<{ conceptNodeId: string; scoreType: string; score: number }> = [];

    await scoreAndRecordQuiz(lessonId, makeQuestions(lessonId), [
      { questionId: "q-mc-correct", answer: 1 },
      { questionId: "q-mc-wrong", answer: 0 },
      { questionId: "q-ft-good", answer: "a genuinely correct explanation" },
      { questionId: "q-ft-bad", answer: "a genuinely correct explanation" },
    ], {
      db,
      orchestratorRun: makeScoringMock() as never,
      writeMasteryUpdate: async (conceptNodeId, scoreType, score) => {
        calls.push({ conceptNodeId, scoreType, score });
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.conceptNodeId).toBe(lessonId);
    expect(calls[0]!.scoreType).toBe("knowledge");
    expect(calls[0]!.score).toBeCloseTo((1 + 1 + 0.9 + 0.9) / 4);
  });
});

describe("checkAndMarkCourseCompletion (Phase 6 completion trigger)", () => {
  beforeEach(() => {
    resetDbCache();
  });

  /** A two-lesson course, so completion genuinely requires BOTH lessons covered, not just one. */
  async function seedTwoLessonCourse(db: TeacherDb): Promise<{ courseId: string; lessonId1: string; lessonId2: string }> {
    const courseId = "crs_completion_test";
    const moduleId = "mod_completion_test";
    const lessonId1 = "lsn_completion_1";
    const lessonId2 = "lsn_completion_2";
    await db.insert(courses).values({
      id: courseId,
      topic: "Completion Test Topic",
      createdAt: new Date().toISOString(),
      volatilityTier: "medium",
      status: "complete",
    });
    await db.insert(modules).values({ id: moduleId, courseId, title: "M", description: "d", order: 0, prerequisiteOf: [] });
    for (const lessonId of [lessonId1, lessonId2]) {
      await db.insert(lessons).values({
        id: lessonId,
        moduleId,
        title: `Lesson ${lessonId}`,
        description: "d",
        estimatedDuration: "5 min",
        layers: {
          intuition: { text: "t", source_ids: [] },
          mechanics: { text: "t", source_ids: [] },
          formal: { text: "t", source_ids: [] },
          application: { text: "t", source_ids: [] },
          frontier: { text: "t", source_ids: [] },
        },
        sourceRefs: [],
        sourceStatus: "ok",
      });
    }
    return { courseId, lessonId1, lessonId2 };
  }

  async function insertQuizResult(db: TeacherDb, lessonId: string, tier: (typeof ALL_QUIZ_TIERS)[number]): Promise<void> {
    await db.insert(quizResults).values({
      id: `qr_${lessonId}_${tier}`,
      lessonId,
      tier,
      score: 0.9,
      date: new Date().toISOString(),
    });
  }

  it("returns null and leaves completedAt untouched when only one lesson has full tier coverage", async () => {
    const db = await getDb(":memory:");
    const { courseId, lessonId1 } = await seedTwoLessonCourse(db);
    for (const tier of ALL_QUIZ_TIERS) await insertQuizResult(db, lessonId1, tier);

    const result = await checkAndMarkCourseCompletion(lessonId1, db);
    expect(result).toBeNull();

    const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
    expect(course!.completedAt).toBeNull();
  });

  it("returns null when a lesson has some but not all three tiers covered", async () => {
    const db = await getDb(":memory:");
    const { lessonId1, lessonId2 } = await seedTwoLessonCourse(db);
    for (const tier of ALL_QUIZ_TIERS) await insertQuizResult(db, lessonId1, tier);
    await insertQuizResult(db, lessonId2, "recall");
    await insertQuizResult(db, lessonId2, "application"); // missing "transfer"

    expect(await checkAndMarkCourseCompletion(lessonId2, db)).toBeNull();
  });

  it("returns the course id and sets completedAt once every lesson has all three tiers covered", async () => {
    const db = await getDb(":memory:");
    const { courseId, lessonId1, lessonId2 } = await seedTwoLessonCourse(db);
    for (const lessonId of [lessonId1, lessonId2]) {
      for (const tier of ALL_QUIZ_TIERS) await insertQuizResult(db, lessonId, tier);
    }

    const result = await checkAndMarkCourseCompletion(lessonId2, db);
    expect(result).toBe(courseId);

    const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
    expect(course!.completedAt).not.toBeNull();
  });

  it("does not re-stamp or re-fire an already-completed course", async () => {
    const db = await getDb(":memory:");
    const { courseId, lessonId1, lessonId2 } = await seedTwoLessonCourse(db);
    for (const lessonId of [lessonId1, lessonId2]) {
      for (const tier of ALL_QUIZ_TIERS) await insertQuizResult(db, lessonId, tier);
    }
    const first = await checkAndMarkCourseCompletion(lessonId1, db);
    expect(first).toBe(courseId);

    const second = await checkAndMarkCourseCompletion(lessonId1, db);
    expect(second).toBeNull();
  });

  it("scoreAndRecordQuiz surfaces courseCompleted only on the call that actually flips it", async () => {
    const db = await getDb(":memory:");
    const { lessonId1, lessonId2 } = await seedTwoLessonCourse(db);
    // Pre-seed lesson 2 with full tier coverage so lesson 1's quiz is the one that completes the course.
    for (const tier of ALL_QUIZ_TIERS) await insertQuizResult(db, lessonId2, tier);

    const questions: QuizQuestion[] = ALL_QUIZ_TIERS.map((tier) => ({
      id: `q-${tier}`,
      tier,
      type: "multiple_choice",
      prompt: "p",
      options: ["a", "b"],
      correctOptionIndex: 0,
    }));
    const answers: QuizAnswer[] = questions.map((q) => ({ questionId: q.id, answer: 0 }));

    const result = await scoreAndRecordQuiz(lessonId1, questions, answers, {
      db,
      orchestratorRun: (async () => {
        throw new Error("should not be called — no free_text questions in this test");
      }) as never,
      writeMasteryUpdate: async () => {},
    });

    expect(result.courseCompleted).toBeDefined();
  });
});

describe("isTransferHighScoreAchieved (Phase 9 milestone trigger)", () => {
  it("is true when the transfer tier score is at or above the threshold", () => {
    expect(isTransferHighScoreAchieved({ transfer: 0.75 }, 0.75)).toBe(true);
    expect(isTransferHighScoreAchieved({ transfer: 0.9 }, 0.75)).toBe(true);
  });

  it("is false when the transfer tier score is below the threshold", () => {
    expect(isTransferHighScoreAchieved({ transfer: 0.74 }, 0.75)).toBe(false);
  });

  it("is false when no transfer tier was tested this session", () => {
    expect(isTransferHighScoreAchieved({ recall: 0.9, application: 0.9 }, 0.75)).toBe(false);
  });

  it("defaults to Phase 5's own high-score threshold (0.75) when none is passed", () => {
    expect(isTransferHighScoreAchieved({ transfer: 0.76 })).toBe(true);
    expect(isTransferHighScoreAchieved({ transfer: 0.5 })).toBe(false);
  });
});

describe("scoreAndRecordQuiz — Phase 9 instrumentation", () => {
  beforeEach(() => resetDbCache());

  it("surfaces transferHighScoreAchieved only on a real transfer-tier high score", async () => {
    const db = await getDb(":memory:");
    const { lessonId } = await seedLesson(db);
    const questions: QuizQuestion[] = [
      { id: "q-transfer", tier: "transfer", type: "multiple_choice", prompt: "p", options: ["a", "b"], correctOptionIndex: 0 },
    ];

    const highResult = await scoreAndRecordQuiz(lessonId, questions, [{ questionId: "q-transfer", answer: 0 }], {
      db,
      orchestratorRun: (async () => {
        throw new Error("no LLM call expected — multiple_choice only");
      }) as never,
      writeMasteryUpdate: async () => {},
    });
    expect(highResult.transferHighScoreAchieved).toBe(true);

    resetDbCache();
    const db2 = await getDb(":memory:");
    const { lessonId: lessonId2 } = await seedLesson(db2);
    const lowResult = await scoreAndRecordQuiz(lessonId2, questions, [{ questionId: "q-transfer", answer: 1 }], {
      db: db2,
      orchestratorRun: (async () => {
        throw new Error("no LLM call expected — multiple_choice only");
      }) as never,
      writeMasteryUpdate: async () => {},
    });
    expect(lowResult.transferHighScoreAchieved).toBe(false);
  });

  it("records a real quiz_completed ActivityEvent scoped to the lesson's real course, via the injectable collaborator", async () => {
    const db = await getDb(":memory:");
    const { lessonId, courseId } = await seedLesson(db);
    const questions: QuizQuestion[] = [
      { id: "q1", tier: "recall", type: "multiple_choice", prompt: "p", options: ["a", "b"], correctOptionIndex: 0 },
    ];

    const calls: Array<{ eventType: string; entityId: string; courseId: string }> = [];
    await scoreAndRecordQuiz(lessonId, questions, [{ questionId: "q1", answer: 0 }], {
      db,
      orchestratorRun: (async () => {
        throw new Error("no LLM call expected");
      }) as never,
      writeMasteryUpdate: async () => {},
      recordActivityEvent: async (eventType, entityId, cId) => {
        calls.push({ eventType, entityId, courseId: cId });
      },
    });

    expect(calls).toEqual([{ eventType: "quiz_completed", entityId: lessonId, courseId }]);
  });

  it("the real (non-injected) recordActivityEvent path genuinely persists the row", async () => {
    const db = await getDb(":memory:");
    const { lessonId, courseId } = await seedLesson(db);
    const questions: QuizQuestion[] = [
      { id: "q1", tier: "recall", type: "multiple_choice", prompt: "p", options: ["a", "b"], correctOptionIndex: 0 },
    ];

    await scoreAndRecordQuiz(lessonId, questions, [{ questionId: "q1", answer: 0 }], {
      db,
      orchestratorRun: (async () => {
        throw new Error("no LLM call expected");
      }) as never,
      writeMasteryUpdate: async () => {},
    });

    const rows = await db.select().from(activityEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ eventType: "quiz_completed", entityId: lessonId, courseId });
  });
});
