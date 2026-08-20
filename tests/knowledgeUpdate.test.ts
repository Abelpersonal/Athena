import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  getDueTopics,
  checkTopicForUpdates,
  runKnowledgeUpdateAgent,
  getWhatsNewDigest,
  type DueTopic,
} from "../src/knowledgeUpdate/index.js";
import { getDb, resetDbCache } from "../src/db/client.js";
import { courses, modules, lessons, updateEvents, lessonUpdates } from "../src/db/schema.js";
import type { TeacherDb } from "../src/db/client.js";
import type { OrchestratorResult, RunOptions } from "../src/orchestrator/index.js";
import type { SearchResult, SearchProvider } from "../src/mcp/webSearch.js";
import type { CleanedContent } from "../src/extraction/fetchAndClean.js";
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

const NOW = new Date("2026-06-01T00:00:00.000Z");
function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

async function seedCourseWithLessons(
  db: TeacherDb,
  id: string,
  overrides: { volatilityTier?: "fast" | "medium" | "slow" | "mixed"; lastChecked?: string | null } = {}
): Promise<{ courseId: string; lessonId: string }> {
  const moduleId = `mod_${id}`;
  const lessonId = `lsn_${id}`;
  await db.insert(courses).values({
    id,
    topic: `Topic ${id}`,
    createdAt: daysAgo(200),
    volatilityTier: overrides.volatilityTier ?? "medium",
    status: "complete",
    lastChecked: overrides.lastChecked === undefined ? null : overrides.lastChecked,
  });
  await db.insert(modules).values({ id: moduleId, courseId: id, title: "M", description: "d", order: 0, prerequisiteOf: [] });
  await db.insert(lessons).values({
    id: lessonId,
    moduleId,
    title: "Lesson One",
    description: "The only lesson.",
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
  return { courseId: id, lessonId };
}

const EMPTY_HISTORY: TopicHistoryResult = { nodes: [], facts: [], episodes: [] };

describe("getDueTopics", () => {
  beforeEach(() => resetDbCache());

  it("treats a never-checked course (lastChecked null) as always due", async () => {
    const db = await getDb(":memory:");
    await seedCourseWithLessons(db, "crs_never", { lastChecked: null });

    const due = await getDueTopics({ db, now: NOW });
    expect(due.map((t) => t.id)).toContain("crs_never");
  });

  it("respects the tier-specific recheck interval (fast=14, medium=60, slow=180)", async () => {
    const db = await getDb(":memory:");
    await seedCourseWithLessons(db, "crs_fast_stale", { volatilityTier: "fast", lastChecked: daysAgo(20) });
    await seedCourseWithLessons(db, "crs_fast_fresh", { volatilityTier: "fast", lastChecked: daysAgo(5) });
    await seedCourseWithLessons(db, "crs_slow_fresh", { volatilityTier: "slow", lastChecked: daysAgo(20) });

    const due = await getDueTopics({ db, now: NOW });
    const dueIds = due.map((t) => t.id);
    expect(dueIds).toContain("crs_fast_stale");
    expect(dueIds).not.toContain("crs_fast_fresh");
    expect(dueIds).not.toContain("crs_slow_fresh");
  });
});

describe("checkTopicForUpdates — severity routing", () => {
  beforeEach(() => resetDbCache());

  function topicRef(courseId: string): DueTopic {
    return { id: courseId, topic: `Topic ${courseId}`, volatilityTier: "medium", goalContext: null, lastChecked: null };
  }

  const searchProvider: SearchProvider = {
    search: async (queries: string[]): Promise<SearchResult[]> =>
      queries.map((q, i) => ({ url: `https://example.com/${i}`, title: `Result ${i}`, snippet: "s", source_id: `src_${i}`, query: q })),
  };
  const fetchAndClean = async (url: string): Promise<CleanedContent> => ({
    text: `Fresh content from ${url}, long enough to be usable.`,
    title: `Title for ${url}`,
    extractionConfidence: 0.9,
    sourceType: "article",
  });

  it("minor delta: writes an UpdateEvent but does NOT call supersedeFact", async () => {
    const db = await getDb(":memory:");
    const { courseId, lessonId } = await seedCourseWithLessons(db, "crs_minor");

    const run: MockRun = async (taskType) => {
      if (taskType === "generate_recheck_queries") return respond(taskType, { queries: ["q1"] });
      if (taskType === "compare_findings_to_facts")
        return respond(taskType, {
          deltas: [
            {
              existingFactSummary: "Old wording.",
              newFindingSummary: "Slightly different wording, same substance.",
              severity: "minor",
              explanation: "Just a phrasing difference.",
              relatedLessonId: lessonId,
            },
          ],
        });
      throw new Error(`unexpected task type ${taskType} for minor test`);
    };

    let supersedeCalls = 0;
    const result = await checkTopicForUpdates(topicRef(courseId), {
      db,
      orchestratorRun: run as never,
      searchProvider,
      fetchAndClean,
      getTopicHistory: async () => EMPTY_HISTORY,
      supersedeFact: async () => {
        supersedeCalls += 1;
      },
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.severity).toBe("minor");
    expect(supersedeCalls).toBe(0);
    expect(result.lessonUpdatesCreated).toHaveLength(0);

    const rows = await db.select().from(updateEvents).where(eq(updateEvents.topicId, courseId));
    expect(rows).toHaveLength(1);
  });

  it("moderate delta: writes an UpdateEvent AND calls supersedeFact, but generates no update lesson", async () => {
    const db = await getDb(":memory:");
    const { courseId, lessonId } = await seedCourseWithLessons(db, "crs_moderate");

    const run: MockRun = async (taskType) => {
      if (taskType === "generate_recheck_queries") return respond(taskType, { queries: ["q1"] });
      if (taskType === "compare_findings_to_facts")
        return respond(taskType, {
          deltas: [
            {
              existingFactSummary: "Old recommended method.",
              newFindingSummary: "A better recommended method now exists.",
              severity: "moderate",
              explanation: "The recommended method changed.",
              relatedLessonId: lessonId,
            },
          ],
        });
      if (taskType === "generate_update_lesson") throw new Error("must not be called for a moderate delta");
      throw new Error(`unexpected task type ${taskType}`);
    };

    const supersedeCalls: Array<{ topic: string; oldClaim: string; newClaim: string }> = [];
    const result = await checkTopicForUpdates(topicRef(courseId), {
      db,
      orchestratorRun: run as never,
      searchProvider,
      fetchAndClean,
      getTopicHistory: async () => EMPTY_HISTORY,
      supersedeFact: async (topic, oldClaim, newClaim) => {
        supersedeCalls.push({ topic, oldClaim, newClaim });
      },
    });

    expect(result.events[0]!.severity).toBe("moderate");
    expect(supersedeCalls).toHaveLength(1);
    expect(supersedeCalls[0]!.newClaim).toBe("A better recommended method now exists.");
    expect(result.lessonUpdatesCreated).toHaveLength(0);
  });

  it("major delta: writes an UpdateEvent, supersedes the fact, AND generates + persists an update lesson linked to the original lesson", async () => {
    const db = await getDb(":memory:");
    const { courseId, lessonId } = await seedCourseWithLessons(db, "crs_major");

    const run: MockRun = async (taskType) => {
      if (taskType === "generate_recheck_queries") return respond(taskType, { queries: ["q1"] });
      if (taskType === "compare_findings_to_facts")
        return respond(taskType, {
          deltas: [
            {
              existingFactSummary: "The old core claim.",
              newFindingSummary: "The claim has been reversed.",
              severity: "major",
              explanation: "A core claim was reversed.",
              relatedLessonId: lessonId,
            },
          ],
        });
      if (taskType === "generate_update_lesson")
        return respond(taskType, {
          title: "Update: the core claim reversed",
          whatChanged: "It used to be X, now it's the opposite.",
          updatedGuidance: "Teach the new version going forward.",
        });
      throw new Error(`unexpected task type ${taskType}`);
    };

    let supersedeCalls = 0;
    const result = await checkTopicForUpdates(topicRef(courseId), {
      db,
      orchestratorRun: run as never,
      searchProvider,
      fetchAndClean,
      getTopicHistory: async () => EMPTY_HISTORY,
      supersedeFact: async () => {
        supersedeCalls += 1;
      },
    });

    expect(result.events[0]!.severity).toBe("major");
    expect(supersedeCalls).toBe(1);
    expect(result.lessonUpdatesCreated).toHaveLength(1);
    expect(result.lessonUpdatesCreated[0]!.lessonId).toBe(lessonId);
    expect(result.lessonUpdatesCreated[0]!.updateEventId).toBe(result.events[0]!.id);

    const rows = await db.select().from(lessonUpdates).where(eq(lessonUpdates.lessonId, lessonId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Update: the core claim reversed");

    // The original lesson itself is never touched/rewritten.
    const [lessonRow] = await db.select().from(lessons).where(eq(lessons.id, lessonId));
    expect(lessonRow!.title).toBe("Lesson One");
  });

  it("a 'none' severity delta is not persisted as an UpdateEvent at all", async () => {
    const db = await getDb(":memory:");
    const { courseId, lessonId } = await seedCourseWithLessons(db, "crs_none");

    const run: MockRun = async (taskType) => {
      if (taskType === "generate_recheck_queries") return respond(taskType, { queries: ["q1"] });
      if (taskType === "compare_findings_to_facts")
        return respond(taskType, {
          deltas: [
            {
              existingFactSummary: "Same fact.",
              newFindingSummary: "Just restates the same fact.",
              severity: "none",
              explanation: "No real change.",
              relatedLessonId: lessonId,
            },
          ],
        });
      throw new Error(`unexpected task type ${taskType}`);
    };

    const result = await checkTopicForUpdates(topicRef(courseId), {
      db,
      orchestratorRun: run as never,
      searchProvider,
      fetchAndClean,
      getTopicHistory: async () => EMPTY_HISTORY,
      supersedeFact: async () => {
        throw new Error("must not be called for a none-severity delta");
      },
    });

    expect(result.events).toHaveLength(0);
  });
});

describe("runKnowledgeUpdateAgent — idempotency", () => {
  beforeEach(() => resetDbCache());

  it("running it twice in a row leaves nothing due the second time (a true no-op)", async () => {
    const db = await getDb(":memory:");
    await seedCourseWithLessons(db, "crs_idem", { lastChecked: null });

    const run: MockRun = async (taskType) => {
      if (taskType === "generate_recheck_queries") return respond(taskType, { queries: ["q1"] });
      if (taskType === "compare_findings_to_facts") return respond(taskType, { deltas: [] });
      throw new Error(`unexpected task type ${taskType}`);
    };
    const searchProvider: SearchProvider = { search: async () => [] };

    const first = await runKnowledgeUpdateAgent({ db, orchestratorRun: run as never, searchProvider, now: NOW });
    expect(first.topicsChecked).toBe(1);

    let secondCallCount = 0;
    const runSecond: MockRun = async (taskType) => {
      secondCallCount += 1;
      throw new Error(`should not be called on a no-op second run (task: ${taskType})`);
    };
    const second = await runKnowledgeUpdateAgent({
      db,
      orchestratorRun: runSecond as never,
      searchProvider,
      now: new Date(NOW.getTime() + 60_000), // one minute later — still nothing due
    });

    expect(second.topicsChecked).toBe(0);
    expect(secondCallCount).toBe(0);
  });
});

describe("getWhatsNewDigest", () => {
  beforeEach(() => resetDbCache());

  // getWhatsNewDigest has no `now` injection point (unlike overlap detection) — a live "what's
  // new" digest is deliberately always relative to REAL wall-clock time, so these events are
  // seeded relative to Date.now(), not the fixed simulated NOW used elsewhere in this file.
  function realDaysAgo(n: number): string {
    return new Date(Date.now() - n * 86_400_000).toISOString();
  }

  it("groups events by severity and attaches the lessonUpdate content only to major items", async () => {
    const db = await getDb(":memory:");
    const { courseId, lessonId } = await seedCourseWithLessons(db, "crs_digest");

    await db.insert(updateEvents).values([
      { id: "ue_minor", topicId: courseId, detectedAt: realDaysAgo(1), severity: "minor", deltaSummary: "minor delta" },
      { id: "ue_moderate", topicId: courseId, detectedAt: realDaysAgo(2), severity: "moderate", deltaSummary: "moderate delta" },
      { id: "ue_major", topicId: courseId, detectedAt: realDaysAgo(3), severity: "major", deltaSummary: "major delta" },
    ]);
    await db.insert(lessonUpdates).values({
      id: "lu_1",
      lessonId,
      updateEventId: "ue_major",
      title: "Update title",
      whatChanged: "changed",
      updatedGuidance: "guidance",
      createdAt: realDaysAgo(3),
    });

    const digest = await getWhatsNewDigest({ db });

    expect(digest.major).toHaveLength(1);
    expect(digest.major[0]!.lessonUpdate?.title).toBe("Update title");
    expect(digest.moderate).toHaveLength(1);
    expect(digest.moderate[0]!.lessonUpdate).toBeUndefined();
    expect(digest.minor).toHaveLength(1);
  });

  it("excludes events older than the sinceDays window", async () => {
    const db = await getDb(":memory:");
    const { courseId } = await seedCourseWithLessons(db, "crs_old");
    await db.insert(updateEvents).values({
      id: "ue_old",
      topicId: courseId,
      detectedAt: new Date(Date.now() - 100 * 86_400_000).toISOString(),
      severity: "major",
      deltaSummary: "very old",
    });

    const digest = await getWhatsNewDigest({ db, sinceDays: 30 });
    expect(digest.major).toHaveLength(0);
  });
});
