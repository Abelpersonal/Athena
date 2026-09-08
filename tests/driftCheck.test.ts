import { describe, it, expect, beforeEach } from "vitest";
import { checkGraphDrift, type GetTopicHistoryFn, type GetCrossCourseConnectionsFn } from "../src/memoryGraph/driftCheck.js";
import { getDb, resetDbCache } from "../src/db/client.js";
import { courses, modules, lessons, masteryState } from "../src/db/schema.js";
import type { TeacherDb } from "../src/db/client.js";
import type { TopicHistoryResult, CrossCourseConnectionsResult } from "../src/memoryGraph/index.js";

async function seedCourse(
  db: TeacherDb,
  overrides: { id?: string; topic?: string } = {}
): Promise<{ courseId: string; lessonId: string }> {
  const courseId = overrides.id ?? "crs_test";
  const moduleId = `mod_${courseId}`;
  const lessonId = `lsn_${courseId}`;
  await db.insert(courses).values({
    id: courseId,
    topic: overrides.topic ?? "Newton's Laws of Motion",
    createdAt: new Date().toISOString(),
    volatilityTier: "medium",
    status: "complete",
  });
  await db.insert(modules).values({ id: moduleId, courseId, title: "M", description: "d", order: 0, prerequisiteOf: [] });
  await db.insert(lessons).values({
    id: lessonId,
    moduleId,
    title: "L",
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
  return { courseId, lessonId };
}

function emptyHistory(): TopicHistoryResult {
  return { nodes: [], facts: [], episodes: [] };
}
function populatedHistory(nodeCount: number, factCount: number): TopicHistoryResult {
  return {
    nodes: Array.from({ length: nodeCount }, (_, i) => ({
      uuid: `n${i}`,
      name: `node ${i}`,
      labels: [],
      created_at: null,
      summary: "s",
      group_id: "g",
      attributes: {},
    })),
    facts: Array.from({ length: factCount }, (_, i) => ({
      uuid: `f${i}`,
      name: `fact ${i}`,
      fact: `fact ${i}`,
      source_node_uuid: "n0",
      target_node_uuid: "n1",
      group_id: "g",
      created_at: null,
      valid_at: null,
      invalid_at: null,
    })),
    episodes: [],
  };
}
function noConnections(): CrossCourseConnectionsResult {
  return { connectedTopics: [] };
}

describe("checkGraphDrift", () => {
  beforeEach(() => resetDbCache());

  it("reports 'in_sync' when the graph has real nodes/facts for a course with no mastery activity yet", async () => {
    const db = await getDb(":memory:");
    const { courseId } = await seedCourse(db);

    const getTopicHistory: GetTopicHistoryFn = async () => populatedHistory(1, 2);
    const getCrossCourseConnections: GetCrossCourseConnectionsFn = async () => noConnections();

    const report = await checkGraphDrift({ db, getTopicHistory, getCrossCourseConnections });

    expect(report.reachable).toBe(true);
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]).toMatchObject({ courseId, status: "in_sync", graphNodeCount: 1, graphFactCount: 2 });
    expect(report.driftedCount).toBe(0);
  });

  it("reports 'missing_from_graph' when SQLite has a course the graph has never heard of", async () => {
    const db = await getDb(":memory:");
    const { courseId } = await seedCourse(db);

    const getTopicHistory: GetTopicHistoryFn = async () => emptyHistory();
    const getCrossCourseConnections: GetCrossCourseConnectionsFn = async () => noConnections();

    const report = await checkGraphDrift({ db, getTopicHistory, getCrossCourseConnections });

    expect(report.reachable).toBe(true);
    expect(report.entries[0]).toMatchObject({ courseId, status: "missing_from_graph" });
    expect(report.driftedCount).toBe(1);
  });

  it("reports 'possibly_stale' when real SQLite mastery activity exists but the graph has zero facts", async () => {
    const db = await getDb(":memory:");
    const { courseId, lessonId } = await seedCourse(db);
    await db.insert(masteryState).values({
      conceptNodeId: lessonId,
      knowledgeScore: 0.8,
      experienceScore: null,
      lastUpdated: new Date().toISOString(),
    });

    // Graph has SOME presence (a node from the initial build-time write) but no facts at all —
    // real activity happened in SQLite with nothing to show for it in the graph.
    const getTopicHistory: GetTopicHistoryFn = async () => populatedHistory(1, 0);
    const getCrossCourseConnections: GetCrossCourseConnectionsFn = async () => noConnections();

    const report = await checkGraphDrift({ db, getTopicHistory, getCrossCourseConnections });

    expect(report.entries[0]).toMatchObject({ courseId, status: "possibly_stale", sqliteMasteryActivityCount: 1 });
    expect(report.driftedCount).toBe(1);
  });

  it("does NOT flag possibly_stale when there's no SQLite mastery activity at all, even with zero graph facts", async () => {
    const db = await getDb(":memory:");
    await seedCourse(db);

    const getTopicHistory: GetTopicHistoryFn = async () => populatedHistory(1, 0);
    const getCrossCourseConnections: GetCrossCourseConnectionsFn = async () => noConnections();

    const report = await checkGraphDrift({ db, getTopicHistory, getCrossCourseConnections });

    expect(report.entries[0]!.status).toBe("in_sync");
  });

  it("checks every course independently — one in sync, one missing", async () => {
    const db = await getDb(":memory:");
    await seedCourse(db, { id: "crs_a", topic: "Topic A" });
    await seedCourse(db, { id: "crs_b", topic: "Topic B" });

    const getTopicHistory: GetTopicHistoryFn = async (topic) =>
      topic === "Topic A" ? populatedHistory(2, 3) : emptyHistory();
    const getCrossCourseConnections: GetCrossCourseConnectionsFn = async () => noConnections();

    const report = await checkGraphDrift({ db, getTopicHistory, getCrossCourseConnections });

    expect(report.entries).toHaveLength(2);
    const byId = new Map(report.entries.map((e) => [e.courseId, e.status]));
    expect(byId.get("crs_a")).toBe("in_sync");
    expect(byId.get("crs_b")).toBe("missing_from_graph");
    expect(report.driftedCount).toBe(1);
  });

  it("surfaces connectedTopicsInGraph as informational context without affecting status", async () => {
    const db = await getDb(":memory:");
    await seedCourse(db);

    const getTopicHistory: GetTopicHistoryFn = async () => populatedHistory(1, 1);
    const getCrossCourseConnections: GetCrossCourseConnectionsFn = async () => ({ connectedTopics: ["Related Topic"] });

    const report = await checkGraphDrift({ db, getTopicHistory, getCrossCourseConnections });

    expect(report.entries[0]).toMatchObject({ status: "in_sync", connectedTopicsInGraph: 1 });
  });

  it("reports unreachable (not crashed, not falsely clean) when the graph can't be reached, preserving courses already checked", async () => {
    const db = await getDb(":memory:");
    await seedCourse(db, { id: "crs_a", topic: "Topic A" });
    await seedCourse(db, { id: "crs_b", topic: "Topic B" });

    const getTopicHistory: GetTopicHistoryFn = async (topic) =>
      topic === "Topic A" ? populatedHistory(1, 1) : { nodes: [], facts: [], episodes: [], error: "ECONNREFUSED" };
    const getCrossCourseConnections: GetCrossCourseConnectionsFn = async () => noConnections();

    const report = await checkGraphDrift({ db, getTopicHistory, getCrossCourseConnections });

    expect(report.reachable).toBe(false);
    expect(report.error).toBe("ECONNREFUSED");
    // Topic A was genuinely checked before the graph became unreachable — its result is preserved.
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]!.courseId).toBe("crs_a");
  });

  it("returns a clean, empty report — not an error — when there are no courses at all", async () => {
    const db = await getDb(":memory:");
    const getTopicHistory: GetTopicHistoryFn = async () => emptyHistory();
    const getCrossCourseConnections: GetCrossCourseConnectionsFn = async () => noConnections();

    const report = await checkGraphDrift({ db, getTopicHistory, getCrossCourseConnections });

    expect(report.reachable).toBe(true);
    expect(report.entries).toEqual([]);
    expect(report.driftedCount).toBe(0);
  });
});
