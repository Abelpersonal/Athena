import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  preparePracticeSession,
  runDialogueTurn,
  critiquePracticeAttempt,
  recordPracticeAttempt,
  difficultyForAttemptNumber,
  PracticeEngineError,
  DEFAULT_ESCALATION_CAP,
  type PracticeSession,
} from "../src/practiceEngine/index.js";
import { getDb, resetDbCache } from "../src/db/client.js";
import { courses, modules, lessons, practiceAttempts, masteryState } from "../src/db/schema.js";
import type { TeacherDb } from "../src/db/client.js";
import type { OrchestratorResult, RunOptions } from "../src/orchestrator/index.js";

async function seedModule(
  db: TeacherDb,
  overrides: { title?: string; description?: string } = {}
): Promise<{ moduleId: string; courseId: string; lessonIds: string[] }> {
  const courseId = "crs_test";
  const moduleId = "mod_test";
  await db
    .insert(courses)
    .values({ id: courseId, topic: "Test Topic", createdAt: new Date().toISOString(), volatilityTier: "medium", status: "complete" });
  await db.insert(modules).values({
    id: moduleId,
    courseId,
    title: overrides.title ?? "SQL Query Writing",
    description: overrides.description ?? "Writing and optimizing SQL SELECT queries.",
    order: 0,
    prerequisiteOf: [],
  });
  const lessonIds = ["lsn_1", "lsn_2"];
  for (const lessonId of lessonIds) {
    await db.insert(lessons).values({
      id: lessonId,
      moduleId,
      title: `Lesson ${lessonId}`,
      description: "A lesson in the module.",
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
  return { moduleId, courseId, lessonIds };
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

function makeSessionPrepMock(opts: {
  topicType: "conceptual" | "skill_based";
  format: "project" | "simulation" | "debate";
}): MockRun {
  return async (taskType, context) => {
    switch (taskType) {
      case "classify_topic_type":
        return respond(taskType, { topicType: opts.topicType, justification: `Classified as ${opts.topicType}.` });
      case "select_practice_format":
        return respond(taskType, { format: opts.format, justification: `Chose ${opts.format}.` });
      case "generate_project_brief":
        return respond(taskType, {
          task: `Task (difficulty: ${context.difficulty})`,
          datasetOrPrompt: "Starting data.",
          deliverableExpectations: "A working query.",
        });
      case "generate_simulation_scenario":
        return respond(taskType, {
          scenario: `Scenario (difficulty: ${context.difficulty})`,
          personaName: "Priya",
          personaRole: "a skeptical product manager",
          personaRules: "Push back on vague answers.",
          openingLine: "So, what's your plan?",
        });
      case "generate_debate_prompt":
        return respond(taskType, {
          claim: "Normalization always improves database performance.",
          userPosition: "against",
          openingArgument: "Normalization is always the right call.",
          opponentRules: "Concede only airtight counterexamples.",
        });
      default:
        throw new Error(`No mock for task type "${taskType}"`);
    }
  };
}

describe("difficultyForAttemptNumber", () => {
  it("attempt 1 is guided", () => {
    expect(difficultyForAttemptNumber(1, 3)).toBe("guided");
  });
  it("attempt 2 (below the cap) is harder", () => {
    expect(difficultyForAttemptNumber(2, 3)).toBe("harder");
  });
  it("the cap'th attempt is novel_unguided", () => {
    expect(difficultyForAttemptNumber(3, 3)).toBe("novel_unguided");
  });
  it("attempts past the cap stay at novel_unguided rather than escalating further", () => {
    expect(difficultyForAttemptNumber(4, 3)).toBe("novel_unguided");
    expect(difficultyForAttemptNumber(10, 3)).toBe("novel_unguided");
  });
  it("defaults to a cap of 3 per the Phase 4 resolved default", () => {
    expect(DEFAULT_ESCALATION_CAP).toBe(3);
  });
});

describe("preparePracticeSession — topic_type classification and format selection", () => {
  beforeEach(() => {
    resetDbCache();
  });

  it("classifies a skill-based module and generates project content for it", async () => {
    const db = await getDb(":memory:");
    const { moduleId } = await seedModule(db, {
      title: "SQL Query Writing",
      description: "Writing and optimizing SQL SELECT queries.",
    });

    const session = await preparePracticeSession(moduleId, {
      db,
      orchestratorRun: makeSessionPrepMock({ topicType: "skill_based", format: "project" }) as never,
    });

    expect(session.topicType).toBe("skill_based");
    expect(session.format).toBe("project");
    expect(session.project).toBeDefined();
    expect(session.project!.task).toContain("guided"); // attempt 1
    expect(session.attemptNumber).toBe(1);
    expect(session.difficulty).toBe("guided");
  });

  it("classifies a conceptual module and generates debate content for it", async () => {
    const db = await getDb(":memory:");
    const { moduleId } = await seedModule(db, {
      title: "Database Normalization Theory",
      description: "Why and when to normalize a relational schema.",
    });

    const session = await preparePracticeSession(moduleId, {
      db,
      orchestratorRun: makeSessionPrepMock({ topicType: "conceptual", format: "debate" }) as never,
    });

    expect(session.topicType).toBe("conceptual");
    expect(session.format).toBe("debate");
    expect(session.debate).toBeDefined();
    expect(session.debate!.claim).toContain("Normalization");
  });

  it("throws PracticeEngineError for an unknown module id", async () => {
    const db = await getDb(":memory:");
    await expect(
      preparePracticeSession("does-not-exist", {
        db,
        orchestratorRun: makeSessionPrepMock({ topicType: "conceptual", format: "debate" }) as never,
      })
    ).rejects.toThrow(PracticeEngineError);
  });

  it("computes attemptNumber from existing PracticeAttempt rows and escalates difficulty accordingly", async () => {
    const db = await getDb(":memory:");
    const { moduleId } = await seedModule(db);
    await db.insert(practiceAttempts).values({
      id: "pa_1",
      moduleId,
      type: "project",
      attemptNumber: 1,
      feedback: "You forgot to handle NULLs in the WHERE clause.",
      reflectionNotes: "I'll double check edge cases next time.",
      date: new Date().toISOString(),
    });

    const contexts: Record<string, unknown>[] = [];
    const mock: MockRun = async (taskType, context) => {
      contexts.push(context);
      return makeSessionPrepMock({ topicType: "skill_based", format: "project" })(taskType, context, "test");
    };

    const session = await preparePracticeSession(moduleId, { db, orchestratorRun: mock as never });

    expect(session.attemptNumber).toBe(2);
    expect(session.difficulty).toBe("harder");
    expect(session.priorMistakes).toContain("NULLs in the WHERE clause");
    // The prior attempt's feedback must actually reach the content-generation template's context.
    expect(contexts.some((c) => typeof c.priorMistakes === "string" && c.priorMistakes.includes("NULLs"))).toBe(true);
  });
});

describe("runDialogueTurn", () => {
  beforeEach(() => {
    resetDbCache();
  });

  it("routes a simulation turn through dialogue_turn with the persona and running history", async () => {
    const session: PracticeSession = {
      moduleId: "mod_test",
      moduleTitle: "Test Module",
      topicType: "skill_based",
      topicTypeJustification: "j",
      format: "simulation",
      formatJustification: "j",
      difficulty: "guided",
      attemptNumber: 1,
      simulation: {
        scenario: "A product review meeting.",
        personaName: "Priya",
        personaRole: "a skeptical product manager",
        personaRules: "Push back on vague answers.",
        openingLine: "So, what's your plan?",
      },
    };

    let capturedContext: Record<string, unknown> | undefined;
    const mock: MockRun = async (taskType, context) => {
      capturedContext = context;
      return respond(taskType, { reply: "That's not specific enough — give me a number." });
    };

    const reply = await runDialogueTurn(
      session,
      [{ speaker: "ai", text: "So, what's your plan?" }],
      "We'll improve conversion.",
      { orchestratorRun: mock as never }
    );

    expect(reply).toBe("That's not specific enough — give me a number.");
    expect(capturedContext!.personaInstructions).toContain("Priya");
    expect(capturedContext!.userInput).toBe("We'll improve conversion.");
  });

  it("throws PracticeEngineError for a project-format session (no dialogue content)", async () => {
    const session: PracticeSession = {
      moduleId: "mod_test",
      moduleTitle: "Test Module",
      topicType: "skill_based",
      topicTypeJustification: "j",
      format: "project",
      formatJustification: "j",
      difficulty: "guided",
      attemptNumber: 1,
      project: { task: "t", datasetOrPrompt: "d", deliverableExpectations: "e" },
    };
    await expect(runDialogueTurn(session, [], "hi", { orchestratorRun: (async () => respond("x", {})) as never })).rejects.toThrow(
      PracticeEngineError
    );
  });
});

describe("critiquePracticeAttempt — must reference what the learner actually did", () => {
  it("threads the learner's actual output into the critique call, not a templated stand-in", async () => {
    const session: PracticeSession = {
      moduleId: "mod_test",
      moduleTitle: "SQL Query Writing",
      topicType: "skill_based",
      topicTypeJustification: "j",
      format: "project",
      formatJustification: "j",
      difficulty: "guided",
      attemptNumber: 1,
      project: {
        task: "Write a query to find the top 5 customers by total spend.",
        datasetOrPrompt: "orders(customer_id, amount)",
        deliverableExpectations: "A single SELECT statement.",
      },
    };
    const learnerSubmission = "SELECT customer_id, SUM(amount) FROM orders GROUP BY customer_id ORDER BY 2 DESC LIMIT 5;";

    let capturedContext: Record<string, unknown> | undefined;
    const mock: MockRun = async (taskType, context) => {
      capturedContext = context;
      return respond(taskType, {
        critique: `Your query "${learnerSubmission}" correctly aggregates and sorts, but doesn't alias SUM(amount).`,
        performanceScore: 0.85,
      });
    };

    const result = await critiquePracticeAttempt(session, learnerSubmission, { orchestratorRun: mock as never });

    expect(capturedContext!.userOutput).toBe(learnerSubmission);
    expect(result.critique).toContain(learnerSubmission);
    expect(result.performanceScore).toBeCloseTo(0.85);
  });
});

describe("recordPracticeAttempt", () => {
  beforeEach(() => {
    resetDbCache();
  });

  it("persists a PracticeAttempt row with the right attempt number, and updates MasteryState.experienceScore for every lesson in the module without touching knowledgeScore", async () => {
    const db = await getDb(":memory:");
    const { moduleId, lessonIds } = await seedModule(db);
    await db.insert(masteryState).values({
      conceptNodeId: lessonIds[0]!,
      knowledgeScore: 0.42,
      experienceScore: null,
      lastUpdated: "2020-01-01T00:00:00.000Z",
    });

    const session: PracticeSession = {
      moduleId,
      moduleTitle: "Test Module",
      topicType: "skill_based",
      topicTypeJustification: "j",
      format: "project",
      formatJustification: "j",
      difficulty: "guided",
      attemptNumber: 1,
      project: { task: "t", datasetOrPrompt: "d", deliverableExpectations: "e" },
    };

    const graphCalls: Array<{ conceptNodeId: string; scoreType: string; score: number }> = [];
    const result = await recordPracticeAttempt(session, "Good first attempt.", "I'd double-check edge cases.", 0.8, {
      db,
      writeMasteryUpdate: async (conceptNodeId, scoreType, score) => {
        graphCalls.push({ conceptNodeId, scoreType, score });
      },
    });

    expect(result.attemptNumber).toBe(1);
    expect(result.updatedLessonIds.sort()).toEqual([...lessonIds].sort());
    expect(result.willEscalateNextAttempt).toBe(true); // attempt 1 < default cap 3

    const [attemptRow] = await db.select().from(practiceAttempts).where(eq(practiceAttempts.id, result.attemptId));
    expect(attemptRow!.moduleId).toBe(moduleId);
    expect(attemptRow!.type).toBe("project");
    expect(attemptRow!.feedback).toBe("Good first attempt.");
    expect(attemptRow!.reflectionNotes).toBe("I'd double-check edge cases.");

    const masteryRows = await db.select().from(masteryState);
    expect(masteryRows).toHaveLength(2);
    const lesson1 = masteryRows.find((r) => r.conceptNodeId === lessonIds[0]);
    expect(lesson1!.experienceScore).toBeCloseTo(0.8);
    expect(lesson1!.knowledgeScore).toBeCloseTo(0.42); // untouched by a practice run
    const lesson2 = masteryRows.find((r) => r.conceptNodeId === lessonIds[1]);
    expect(lesson2!.experienceScore).toBeCloseTo(0.8);
    expect(lesson2!.knowledgeScore).toBeNull(); // no quiz has ever run for this lesson

    expect(graphCalls).toHaveLength(2);
    expect(graphCalls.every((c) => c.scoreType === "experience")).toBe(true);
  });

  it("reports willEscalateNextAttempt: false once the escalation cap is reached", async () => {
    const db = await getDb(":memory:");
    const { moduleId } = await seedModule(db);
    const session: PracticeSession = {
      moduleId,
      moduleTitle: "Test Module",
      topicType: "skill_based",
      topicTypeJustification: "j",
      format: "project",
      formatJustification: "j",
      difficulty: "novel_unguided",
      attemptNumber: 3,
      project: { task: "t", datasetOrPrompt: "d", deliverableExpectations: "e" },
    };

    const result = await recordPracticeAttempt(session, "Solid.", "Nothing major.", 0.9, {
      db,
      writeMasteryUpdate: async () => {},
      escalationCap: 3,
    });

    expect(result.willEscalateNextAttempt).toBe(false);
  });
});
