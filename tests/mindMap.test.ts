import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { generateMindMap, MindMapError } from "../src/mindMap/index.js";
import { getDb, resetDbCache } from "../src/db/client.js";
import { courses, modules, lessons, mindMaps } from "../src/db/schema.js";
import type { TeacherDb } from "../src/db/client.js";
import type { OrchestratorResult, RunOptions } from "../src/orchestrator/index.js";

type MockRun = (
  taskType: string,
  context: Record<string, unknown>,
  callingModule: string,
  options?: RunOptions
) => Promise<OrchestratorResult<unknown>>;

function respond(taskType: string, data: unknown): OrchestratorResult<unknown> {
  return { taskType, promptVersion: "test", data, attempts: 1, raw: JSON.stringify(data) };
}

const FIVE_LAYERS = {
  intuition: { text: "t", source_ids: [] },
  mechanics: { text: "t", source_ids: [] },
  formal: { text: "t", source_ids: [] },
  application: { text: "t", source_ids: [] },
  frontier: { text: "t", source_ids: [] },
};

async function seedCourse(db: TeacherDb): Promise<{ courseId: string; lessonIds: string[] }> {
  const courseId = "crs_mindmap_test";
  await db.insert(courses).values({ id: courseId, topic: "Special Relativity", createdAt: "2026-01-01T00:00:00.000Z", volatilityTier: "medium", status: "complete" });
  await db.insert(modules).values({ id: "mod_1", courseId, title: "Foundations", description: "d", order: 0, prerequisiteOf: [] });
  const lessonIds = ["lsn_1", "lsn_2", "lsn_3"];
  for (const id of lessonIds) {
    await db.insert(lessons).values({
      id,
      moduleId: "mod_1",
      title: `Lesson ${id}`,
      description: "d",
      estimatedDuration: "5 min",
      layers: FIVE_LAYERS,
      sourceRefs: [],
      sourceStatus: "ok",
    });
  }
  return { courseId, lessonIds };
}

describe("generateMindMap", () => {
  beforeEach(() => resetDbCache());

  it("throws MindMapError for an unknown course id", async () => {
    const db = await getDb(":memory:");
    await expect(
      generateMindMap("does-not-exist", { db, orchestratorRun: (async () => {
        throw new Error("should not be called");
      }) as never, writeMindMapNodes: async () => {} })
    ).rejects.toThrow(MindMapError);
  });

  it("persists a real, validated graph whose node ids are a genuine subset of the course's real lesson ids", async () => {
    const db = await getDb(":memory:");
    const { courseId, lessonIds } = await seedCourse(db);

    const mock: MockRun = async (taskType) =>
      respond(taskType, {
        nodes: [
          { lessonId: lessonIds[0], conceptLabel: "Time Dilation" },
          { lessonId: lessonIds[1], conceptLabel: "Length Contraction" },
        ],
        edges: [{ source: lessonIds[0], target: lessonIds[1], type: "prerequisite" }],
      });

    const writeCalls: unknown[] = [];
    const result = await generateMindMap(courseId, {
      db,
      orchestratorRun: mock as never,
      writeMindMapNodes: async (...args) => {
        writeCalls.push(args);
      },
    });

    expect(result.graph.nodes).toHaveLength(2);
    expect(result.graph.nodes.every((n) => lessonIds.includes(n.id))).toBe(true);
    expect(result.graph.edges).toEqual([{ source: lessonIds[0], target: lessonIds[1], type: "prerequisite" }]);
    expect(writeCalls).toHaveLength(1);

    const [row] = await db.select().from(mindMaps).where(eq(mindMaps.courseId, courseId));
    expect(row).toBeDefined();
    expect(row!.graphJson.nodes).toHaveLength(2);
  });

  it("rejects (via validateExtra) a response whose node references a lessonId outside this course — the same grounding discipline as tests/grounding.test.ts", async () => {
    const db = await getDb(":memory:");
    const { courseId } = await seedCourse(db);

    let capturedValidateExtra: RunOptions["validateExtra"];
    const mock: MockRun = async (taskType, _context, _module, options) => {
      capturedValidateExtra = options?.validateExtra;
      return respond(taskType, { nodes: [{ lessonId: "lsn_1", conceptLabel: "Real" }], edges: [] });
    };

    await generateMindMap(courseId, { db, orchestratorRun: mock as never, writeMindMapNodes: async () => {} });

    expect(capturedValidateExtra).toBeDefined();
    const rejected = capturedValidateExtra!({
      nodes: [{ lessonId: "lsn_from_a_totally_different_course", conceptLabel: "Fabricated" }],
      edges: [],
    });
    expect(rejected).toMatchObject({ success: false });
  });

  it("rejects an edge referencing a lessonId not present in this graph's own nodes array (a dangling edge)", async () => {
    const db = await getDb(":memory:");
    const { courseId, lessonIds } = await seedCourse(db);

    let capturedValidateExtra: RunOptions["validateExtra"];
    const mock: MockRun = async (taskType, _context, _module, options) => {
      capturedValidateExtra = options?.validateExtra;
      return respond(taskType, { nodes: [{ lessonId: lessonIds[0], conceptLabel: "A" }], edges: [] });
    };
    await generateMindMap(courseId, { db, orchestratorRun: mock as never, writeMindMapNodes: async () => {} });

    // A real lesson id (lessonIds[2]) that IS in the course, but was never included as a node in this specific graph.
    const rejected = capturedValidateExtra!({
      nodes: [{ lessonId: lessonIds[0], conceptLabel: "A" }],
      edges: [{ source: lessonIds[0], target: lessonIds[2], type: "cross_link" }],
    });
    expect(rejected).toMatchObject({ success: false });
  });

  it("upserts on a re-run — overwrites the existing row for the same course rather than duplicating or erroring", async () => {
    const db = await getDb(":memory:");
    const { courseId, lessonIds } = await seedCourse(db);
    const mockA: MockRun = async (taskType) =>
      respond(taskType, { nodes: [{ lessonId: lessonIds[0], conceptLabel: "First" }], edges: [] });
    const mockB: MockRun = async (taskType) =>
      respond(taskType, { nodes: [{ lessonId: lessonIds[1], conceptLabel: "Second" }], edges: [] });

    await generateMindMap(courseId, { db, orchestratorRun: mockA as never, writeMindMapNodes: async () => {} });
    await generateMindMap(courseId, { db, orchestratorRun: mockB as never, writeMindMapNodes: async () => {} });

    const rows = await db.select().from(mindMaps).where(eq(mindMaps.courseId, courseId));
    expect(rows).toHaveLength(1); // not duplicated
    expect(rows[0]!.graphJson.nodes[0]!.conceptLabel).toBe("Second"); // overwritten, not merged
  });
});
