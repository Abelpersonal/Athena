import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  getCourseCompletionContext,
  generateBookRecommendations,
  generateNextTopicSuggestions,
  isDomainClusterNarrow,
  ContinuousLearningError,
  type CourseCompletionContext,
} from "../src/continuousLearning/index.js";
import { getDb, resetDbCache } from "../src/db/client.js";
import { courses, modules, lessons, books } from "../src/db/schema.js";
import type { TeacherDb } from "../src/db/client.js";
import type { OrchestratorResult, RunOptions } from "../src/orchestrator/index.js";
import type { OpenLibraryBookResult } from "../src/mcp/openLibrary.js";
import type { GutenbergMatch } from "../src/mcp/gutenberg.js";
import type { TopicHistoryResult } from "../src/memoryGraph/index.js";

type MockRun = (
  taskType: string,
  context: Record<string, unknown>,
  callingModule: string,
  options?: RunOptions
) => Promise<OrchestratorResult<unknown>>;

function respond(taskType: string, data: unknown): OrchestratorResult<unknown> {
  return { taskType, promptVersion: "test", data, attempts: 1, raw: JSON.stringify(data) };
}

const EMPTY_HISTORY: TopicHistoryResult = { nodes: [], facts: [], episodes: [] };

async function seedCourse(
  db: TeacherDb,
  options: { completed: boolean; goalContext?: string } = { completed: true }
): Promise<{ courseId: string }> {
  const courseId = "crs_cl_test";
  const moduleId = "mod_cl_test";
  await db.insert(courses).values({
    id: courseId,
    topic: "Special Relativity",
    createdAt: new Date().toISOString(),
    volatilityTier: "medium",
    status: "complete",
    goalContext: options.goalContext ?? null,
    completedAt: options.completed ? new Date().toISOString() : null,
  });
  await db.insert(modules).values({ id: moduleId, courseId, title: "M", description: "d", order: 0, prerequisiteOf: [] });
  await db.insert(lessons).values({
    id: "lsn_cl_test",
    moduleId,
    title: "Time Dilation",
    description: "How time dilates near light speed.",
    estimatedDuration: "10 min",
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
  return { courseId };
}

describe("getCourseCompletionContext (trigger guard)", () => {
  beforeEach(() => resetDbCache());

  it("throws ContinuousLearningError for a course that isn't complete yet", async () => {
    const db = await getDb(":memory:");
    const { courseId } = await seedCourse(db, { completed: false });

    await expect(
      getCourseCompletionContext(courseId, { db, getTopicHistory: async () => EMPTY_HISTORY })
    ).rejects.toThrow(ContinuousLearningError);
  });

  it("throws ContinuousLearningError for an unknown course id", async () => {
    const db = await getDb(":memory:");
    await expect(
      getCourseCompletionContext("does-not-exist", { db, getTopicHistory: async () => EMPTY_HISTORY })
    ).rejects.toThrow(ContinuousLearningError);
  });

  it("succeeds and returns lessons + topic history for a genuinely completed course", async () => {
    const db = await getDb(":memory:");
    const { courseId } = await seedCourse(db, { completed: true });

    const context = await getCourseCompletionContext(courseId, { db, getTopicHistory: async () => EMPTY_HISTORY });
    expect(context.course.id).toBe(courseId);
    expect(context.lessons).toHaveLength(1);
    expect(context.courseSummary).toContain("Time Dilation");
  });
});

describe("generateBookRecommendations", () => {
  beforeEach(() => resetDbCache());

  function context(courseId: string): CourseCompletionContext {
    return {
      course: {
        id: courseId,
        topic: "Special Relativity",
        createdAt: "",
        volatilityTier: "medium",
        status: "complete",
        goalContext: null,
        completedAt: new Date().toISOString(),
        lastChecked: null,
      },
      lessons: [],
      topicHistory: EMPTY_HISTORY,
      courseSummary: "Covers time dilation and length contraction.",
    };
  }

  it("persists only VERIFIED candidates (dropping ones Open Library can't confirm)", async () => {
    const db = await getDb(":memory:");
    const { courseId } = await seedCourse(db);

    const run: MockRun = async (taskType) => {
      if (taskType === "generate_book_candidates") {
        return respond(taskType, {
          candidates: [
            { title: "Real Verifiable Book", author: "Real Author", category: "core", rationale: "r" },
            { title: "Hallucinated Fake Book", author: "Nobody", category: "optional_deep_dive", rationale: "r" },
          ],
        });
      }
      throw new Error(`unexpected task type ${taskType}`);
    };
    const searchOpenLibrary = async (title: string): Promise<OpenLibraryBookResult[]> =>
      title === "Real Verifiable Book" ? [{ title, author: "Real Author", workId: "OL1W", editionCount: 3 }] : [];
    const checkGutenberg = async (): Promise<GutenbergMatch | null> => null;

    const result = await generateBookRecommendations(courseId, context(courseId), {
      db,
      orchestratorRun: run as never,
      searchOpenLibrary,
      checkGutenberg,
    });

    expect(result.persisted).toHaveLength(1);
    expect(result.persisted[0]!.title).toBe("Real Verifiable Book");
    expect(result.persisted[0]!.openLibraryWorkId).toBe("OL1W");
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.title).toBe("Hallucinated Fake Book");

    const rows = await db.select().from(books).where(eq(books.relatedTopicId, courseId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Real Verifiable Book");
    expect(rows[0]!.status).toBe("suggested");
  });

  it("records a gutenbergUrl only when Gutenberg confirms a legitimate free full text", async () => {
    const db = await getDb(":memory:");
    const { courseId } = await seedCourse(db);

    const run: MockRun = async (taskType) =>
      respond(taskType, {
        candidates: [{ title: "Classic Text", author: "Old Author", category: "primary_source", rationale: "r" }],
      });
    const searchOpenLibrary = async (): Promise<OpenLibraryBookResult[]> => [{ title: "Classic Text", author: "Old Author", workId: "OL2W" }];
    const checkGutenberg = async (): Promise<GutenbergMatch | null> => ({
      gutenbergId: 42,
      title: "Classic Text",
      url: "https://www.gutenberg.org/ebooks/42",
    });

    const result = await generateBookRecommendations(courseId, context(courseId), {
      db,
      orchestratorRun: run as never,
      searchOpenLibrary,
      checkGutenberg,
    });

    expect(result.persisted[0]!.gutenbergUrl).toBe("https://www.gutenberg.org/ebooks/42");
    const [row] = await db.select().from(books).where(eq(books.relatedTopicId, courseId));
    expect(row!.gutenbergUrl).toBe("https://www.gutenberg.org/ebooks/42");
  });
});

describe("isDomainClusterNarrow (pure)", () => {
  it("is never narrow below the minimum sample size, even if 100% match", () => {
    expect(isDomainClusterNarrow(["Math", "Math"])).toBe(false); // only 2, default minSample is 3
  });

  it("is narrow when the top domain's share meets the threshold with enough samples", () => {
    expect(isDomainClusterNarrow(["Math", "Math", "Math", "History"])).toBe(true); // 3/4 = 0.75 >= 0.6
  });

  it("is not narrow when domains are genuinely spread out", () => {
    expect(isDomainClusterNarrow(["Math", "History", "Biology", "Art", "Music"])).toBe(false);
  });

  it("respects a custom threshold and minSample", () => {
    expect(isDomainClusterNarrow(["Math", "Math", "History"], 0.5, 3)).toBe(true); // 2/3 ≈ 0.667 >= 0.5
    expect(isDomainClusterNarrow(["Math", "History"], 0.5, 1)).toBe(true); // 1/2 = 0.5 >= 0.5, minSample 1
  });
});

describe("generateNextTopicSuggestions", () => {
  beforeEach(() => resetDbCache());

  function context(): CourseCompletionContext {
    return {
      course: {
        id: "crs_cl_test",
        topic: "Special Relativity",
        createdAt: "",
        volatilityTier: "medium",
        status: "complete",
        goalContext: null,
        completedAt: new Date().toISOString(),
        lastChecked: null,
      },
      lessons: [],
      topicHistory: EMPTY_HISTORY,
      courseSummary: "Covers time dilation.",
    };
  }

  it("threads real cross-course connections and the diversity bias flag into the LLM call", async () => {
    const db = await getDb(":memory:");
    await seedCourse(db);

    let capturedContext: Record<string, unknown> | undefined;
    const run: MockRun = async (taskType, ctx) => {
      capturedContext = ctx;
      return respond(taskType, {
        deepen: { topicName: "General Relativity", description: "d", rationale: "r" },
        branch: { topicName: "Differential Geometry", description: "d", domain: "Math", rationale: "r" },
      });
    };

    const result = await generateNextTopicSuggestions("crs_cl_test", context(), {
      db,
      orchestratorRun: run as never,
      getCrossCourseConnections: async () => ({ connectedTopics: ["Newtonian Mechanics"] }),
      // No other completed courses seeded -> below minSample -> diversity bias should be false.
    });

    expect(capturedContext?.crossCourseConnections).toEqual(["Newtonian Mechanics"]);
    expect(capturedContext?.diversityBiasNeeded).toBe(false);
    expect(result.crossCourseConnections).toEqual(["Newtonian Mechanics"]);
    expect(result.diversityBiasApplied).toBe(false);
    expect(result.deepen.topicName).toBe("General Relativity");
    expect(result.branch.domain).toBe("Math");
  });

  it("applies the diversity bias when recent completed courses cluster narrowly", async () => {
    const db = await getDb(":memory:");
    await seedCourse(db);
    // Seed 3 more completed courses under the same domain (path-linked isn't set up here, so
    // getRecentCourseDomains falls back to infer_course_domain, which this mock always answers "Math").
    for (let i = 0; i < 3; i++) {
      await db.insert(courses).values({
        id: `crs_extra_${i}`,
        topic: `Extra Topic ${i}`,
        createdAt: new Date().toISOString(),
        volatilityTier: "medium",
        status: "complete",
        completedAt: new Date(Date.now() - i * 1000).toISOString(),
      });
    }

    let diversityBiasNeededSeen: unknown;
    const run: MockRun = async (taskType, ctx) => {
      if (taskType === "infer_course_domain") return respond(taskType, { domain: "Math" });
      diversityBiasNeededSeen = ctx.diversityBiasNeeded;
      return respond(taskType, {
        deepen: { topicName: "D", description: "d", rationale: "r" },
        branch: { topicName: "B", description: "d", domain: "History", rationale: "r" },
      });
    };

    const result = await generateNextTopicSuggestions("crs_cl_test", context(), {
      db,
      orchestratorRun: run as never,
      getCrossCourseConnections: async () => ({ connectedTopics: [] }),
    });

    expect(result.diversityBiasApplied).toBe(true);
    expect(diversityBiasNeededSeen).toBe(true);
  });
});
