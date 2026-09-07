import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  classifyInput,
  decomposeAndPersistPath,
  persistDecomposedGoal,
  runOverlapDetectionForPath,
  loadPathRoadmap,
  isTopicGeneratable,
  generateTopicCourse,
  PathPlannerError,
  type GeneratableCheckTopic,
  type RawGoalDecomposition,
} from "../src/pathPlanner/index.js";
import type { OverlapResult } from "../src/pathPlanner/overlap.js";
import { getDb, resetDbCache } from "../src/db/client.js";
import { paths, pathDomains, pathTopics, courses } from "../src/db/schema.js";
import type { TeacherDb } from "../src/db/client.js";
import type { OrchestratorResult, RunOptions } from "../src/orchestrator/index.js";
import type { CourseJson } from "../src/research/types.js";
import type { RunResearchPipelineOptions } from "../src/research/pipeline.js";
import type { BuildCourseResult } from "../src/courseBuilder/index.js";
import type { GenerateMindMapResult } from "../src/mindMap/index.js";

type MockRun = (
  taskType: string,
  context: Record<string, unknown>,
  callingModule: string,
  options?: RunOptions
) => Promise<OrchestratorResult<unknown>>;

function respond(taskType: string, data: unknown): OrchestratorResult<unknown> {
  return { taskType, promptVersion: "test", data, attempts: 1, raw: JSON.stringify(data) };
}

// ---------------------------------------------------------------------------
// Deliverable 1: classification
// ---------------------------------------------------------------------------

describe("classifyInput", () => {
  it("returns 'topic' for a narrow single-subject input (boundary case)", async () => {
    let capturedInput: string | undefined;
    const mock: MockRun = async (taskType, context) => {
      capturedInput = context.input as string;
      return respond(taskType, { classification: "topic", reasoning: "One coherent subject." });
    };
    const result = await classifyInput("Special Relativity", { orchestratorRun: mock as never });
    expect(capturedInput).toBe("Special Relativity");
    expect(result.classification).toBe("topic");
  });

  it("returns 'goal' for a broad multi-domain input (boundary case)", async () => {
    const mock: MockRun = async (taskType) =>
      respond(taskType, { classification: "goal", reasoning: "Requires multiple independent skill domains." });
    const result = await classifyInput("become a full-stack quant", { orchestratorRun: mock as never });
    expect(result.classification).toBe("goal");
    expect(result.reasoning).toContain("domains");
  });
});

// ---------------------------------------------------------------------------
// Deliverable 2: decomposition + cross-domain ordering + persistence
// ---------------------------------------------------------------------------

describe("decomposeAndPersistPath", () => {
  beforeEach(() => {
    resetDbCache();
  });

  it("persists Path/PathDomain/PathTopic rows with course_id null and status pending, respecting a real cross-domain dependency in the derived order", async () => {
    const db = await getDb(":memory:");
    const mock: MockRun = async (taskType, context) => {
      if (taskType === "decompose_goal_into_path") {
        return respond(taskType, {
          domains: [
            { tempId: "d1", name: "Math" },
            { tempId: "d2", name: "Programming" },
          ],
          topics: [
            { tempId: "t1", domainTempId: "d1", topicName: "Linear Algebra", description: "Vectors and matrices." },
            { tempId: "t2", domainTempId: "d2", topicName: "NumPy for Linear Algebra", description: "Applying linear algebra in code." },
          ],
        });
      }
      if (taskType === "determine_cross_domain_dependencies") {
        // The Programming-domain topic depends on the Math-domain topic — a real cross-domain edge.
        return respond(taskType, {
          dependencies: [
            { topicTempId: "t1", dependsOnTempIds: [] },
            { topicTempId: "t2", dependsOnTempIds: ["t1"] },
          ],
        });
      }
      throw new Error(`No mock for task type "${taskType}" (context: ${JSON.stringify(context)})`);
    };

    const result = await decomposeAndPersistPath("become a full-stack quant", { db, orchestratorRun: mock as never });
    expect(result.outcome).toBe("persisted");
    if (result.outcome !== "persisted") throw new Error("expected a persisted outcome");
    expect(result.domainCount).toBe(2);
    expect(result.topicCount).toBe(2);

    const persistedDomains = await db.select().from(pathDomains).where(eq(pathDomains.pathId, result.pathId));
    expect(persistedDomains.map((d) => d.name).sort()).toEqual(["Math", "Programming"]);

    const persistedTopics = await db.select().from(pathTopics).where(eq(pathTopics.pathId, result.pathId));
    expect(persistedTopics).toHaveLength(2);
    for (const t of persistedTopics) {
      expect(t.courseId).toBeNull();
      expect(t.status).toBe("pending");
    }

    const linAlg = persistedTopics.find((t) => t.topicName === "Linear Algebra")!;
    const numpy = persistedTopics.find((t) => t.topicName === "NumPy for Linear Algebra")!;
    expect(linAlg.order).toBe(0);
    expect(numpy.order).toBe(1);
    expect(numpy.order).toBeGreaterThan(linAlg.order); // the cross-domain dependency is reflected in the persisted order
    expect(linAlg.parallelGroup).not.toBe(numpy.parallelGroup);
  });

  it("returns an unpersisted 'oversized' outcome (not a throw) when decompose_goal_into_path returns an implausibly large number of topics (Graceful Over-Large-Goal Handling)", async () => {
    const db = await getDb(":memory:");
    // PATH_TOPIC_COUNT_HARD_LIMIT is 3x the 40-topic warning threshold (120) — 121 exceeds it.
    const manyTopics = Array.from({ length: 121 }, (_, i) => ({
      tempId: `t${i}`,
      domainTempId: "d1",
      topicName: `Topic ${i}`,
      description: "d",
    }));
    const mock: MockRun = async (taskType) => {
      if (taskType === "decompose_goal_into_path") {
        return respond(taskType, { domains: [{ tempId: "d1", name: "Domain" }], topics: manyTopics });
      }
      if (taskType === "determine_cross_domain_dependencies") {
        return respond(taskType, { dependencies: manyTopics.map((t) => ({ topicTempId: t.tempId, dependsOnTempIds: [] })) });
      }
      throw new Error(`No mock for task type "${taskType}"`);
    };

    const result = await decomposeAndPersistPath("an implausibly broad goal", { db, orchestratorRun: mock as never });

    expect(result.outcome).toBe("oversized");
    if (result.outcome !== "oversized") throw new Error("expected an oversized outcome");
    expect(result.topicCount).toBe(121);
    expect(result.hardLimit).toBe(120);
    expect(result.domainBreakdown).toEqual([{ name: "Domain", topicCount: 121 }]);

    // Nothing is persisted yet — the caller decides (proceed/split/abort) via persistDecomposedGoal().
    const persistedTopics = await db.select().from(pathTopics);
    expect(persistedTopics).toHaveLength(0);
    const persistedPaths = await db.select().from(paths);
    expect(persistedPaths).toHaveLength(0);
  });

  it("still only warns (does not throw, still persists normally) just below the hard ceiling, at the existing warning threshold", async () => {
    const db = await getDb(":memory:");
    const someTopics = Array.from({ length: 40 }, (_, i) => ({
      tempId: `t${i}`,
      domainTempId: "d1",
      topicName: `Topic ${i}`,
      description: "d",
    }));
    const mock: MockRun = async (taskType) => {
      if (taskType === "decompose_goal_into_path") {
        return respond(taskType, { domains: [{ tempId: "d1", name: "Domain" }], topics: someTopics });
      }
      if (taskType === "determine_cross_domain_dependencies") {
        return respond(taskType, { dependencies: someTopics.map((t) => ({ topicTempId: t.tempId, dependsOnTempIds: [] })) });
      }
      throw new Error(`No mock for task type "${taskType}"`);
    };

    const result = await decomposeAndPersistPath("a broad but plausible goal", { db, orchestratorRun: mock as never });
    expect(result.outcome).toBe("persisted");
    if (result.outcome !== "persisted") throw new Error("expected a persisted outcome");
    expect(result.topicCount).toBe(40);
  });
});

describe("persistDecomposedGoal (Graceful Over-Large-Goal Handling)", () => {
  beforeEach(() => {
    resetDbCache();
  });

  function makeDecomposition(): RawGoalDecomposition {
    // Three domains at three real tiers (Math -> Programming -> Finance, a genuine cross-domain
    // chain), 2 topics each — enough to exercise a real 3-way phased split along real boundaries.
    return {
      goalDescription: "become a full-stack quant",
      domains: [
        { tempId: "d1", name: "Math" },
        { tempId: "d2", name: "Programming" },
        { tempId: "d3", name: "Finance" },
      ],
      topics: [
        { tempId: "t1", domainTempId: "d1", topicName: "Linear Algebra", description: "d", order: 0, parallelGroup: "tier_0" },
        { tempId: "t2", domainTempId: "d1", topicName: "Calculus", description: "d", order: 0, parallelGroup: "tier_0" },
        { tempId: "t3", domainTempId: "d2", topicName: "NumPy", description: "d", order: 1, parallelGroup: "tier_1" },
        { tempId: "t4", domainTempId: "d2", topicName: "Pandas", description: "d", order: 1, parallelGroup: "tier_1" },
        { tempId: "t5", domainTempId: "d3", topicName: "Options Pricing", description: "d", order: 2, parallelGroup: "tier_2" },
        { tempId: "t6", domainTempId: "d3", topicName: "Portfolio Theory", description: "d", order: 2, parallelGroup: "tier_2" },
      ],
      topicCount: 6,
      hardLimit: 120,
      domainBreakdown: [
        { name: "Math", topicCount: 2 },
        { name: "Programming", topicCount: 2 },
        { name: "Finance", topicCount: 2 },
      ],
    };
  }

  it('"proceed" persists the WHOLE decomposition as exactly one Path, with every domain/topic intact', async () => {
    const db = await getDb(":memory:");
    const decomposition = makeDecomposition();

    const results = await persistDecomposedGoal(decomposition, "proceed", { db });

    expect(results).toHaveLength(1);
    const [result] = results;
    expect(result!.domainCount).toBe(3);
    expect(result!.topicCount).toBe(6);

    const persistedDomains = await db.select().from(pathDomains).where(eq(pathDomains.pathId, result!.pathId));
    expect(persistedDomains.map((d) => d.name).sort()).toEqual(["Finance", "Math", "Programming"]);
    const persistedTopics = await db.select().from(pathTopics).where(eq(pathTopics.pathId, result!.pathId));
    expect(persistedTopics).toHaveLength(6);
  });

  it('"split" persists 2-3 correctly-domain-partitioned Paths — a domain never straddles two Paths — without re-decomposing anything', async () => {
    const db = await getDb(":memory:");
    const decomposition = makeDecomposition();

    const results = await persistDecomposedGoal(decomposition, "split", { db });

    // 3 domains -> up to 3 phases; each phase is its own real, persisted Path row.
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.length).toBeLessThanOrEqual(3);
    expect(results.reduce((sum, r) => sum + r.topicCount, 0)).toBe(6); // every topic accounted for exactly once

    const allPersistedTopicNames = new Set<string>();
    const domainNamesByPath: string[][] = [];
    for (const r of results) {
      const persistedDomains = await db.select().from(pathDomains).where(eq(pathDomains.pathId, r.pathId));
      const persistedTopics = await db.select().from(pathTopics).where(eq(pathTopics.pathId, r.pathId));
      domainNamesByPath.push(persistedDomains.map((d) => d.name).sort());
      for (const t of persistedTopics) allPersistedTopicNames.add(t.topicName);

      // Every persisted topic's real domain (by name) is one of THIS path's own persisted domains
      // — a phase never contains a topic whose domain wasn't assigned to it (no cross-phase leaks).
      const domainIds = new Set(persistedDomains.map((d) => d.id));
      expect(persistedTopics.every((t) => domainIds.has(t.domainId))).toBe(true);
    }

    // No domain name appears in more than one persisted Path — a domain is never split across phases.
    const allDomainNames = domainNamesByPath.flat();
    expect(new Set(allDomainNames).size).toBe(allDomainNames.length);
    expect(allDomainNames.sort()).toEqual(["Finance", "Math", "Programming"]);

    // Every real topic name from the original decomposition survived the split intact.
    expect([...allPersistedTopicNames].sort()).toEqual(
      ["Calculus", "Linear Algebra", "NumPy", "Options Pricing", "Pandas", "Portfolio Theory"].sort()
    );

    // Phase 1 (the earliest-tier domain, Math) really is presented/persisted first.
    const [firstPhase] = results;
    const firstPhaseDomains = await db.select().from(pathDomains).where(eq(pathDomains.pathId, firstPhase!.pathId));
    expect(firstPhaseDomains.map((d) => d.name)).toContain("Math");
  });
});

// ---------------------------------------------------------------------------
// Deliverable 3: overlap detection
// ---------------------------------------------------------------------------

async function seedPathDirectly(
  db: TeacherDb,
  topicSpecs: Array<{ id: string; name: string; order: number; parallelGroup: string; status?: string; courseId?: string | null }>
): Promise<{ pathId: string; domainId: string }> {
  const pathId = "path_test";
  const domainId = "dom_test";
  await db.insert(paths).values({ id: pathId, goalDescription: "Goal X", createdAt: new Date().toISOString(), status: "active" });
  await db.insert(pathDomains).values({ id: domainId, pathId, name: "Domain A", order: 0 });
  for (const spec of topicSpecs) {
    await db.insert(pathTopics).values({
      id: spec.id,
      pathId,
      domainId,
      topicName: spec.name,
      description: "d",
      order: spec.order,
      parallelGroup: spec.parallelGroup,
      courseId: spec.courseId ?? null,
      status: (spec.status ?? "pending") as never,
    });
  }
  return { pathId, domainId };
}

describe("runOverlapDetectionForPath", () => {
  beforeEach(() => {
    resetDbCache();
  });

  it("persists each topic's resolved status/courseId and returns the annotated roadmap", async () => {
    const db = await getDb(":memory:");
    const { pathId } = await seedPathDirectly(db, [
      { id: "pt_a", name: "Topic A", order: 0, parallelGroup: "tier_0" },
      { id: "pt_b", name: "Topic B", order: 0, parallelGroup: "tier_0" },
    ]);

    await db.insert(courses).values({
      id: "crs_existing",
      topic: "Topic A",
      createdAt: new Date().toISOString(),
      volatilityTier: "medium",
      status: "complete",
      goalContext: null,
    });

    const resultsByTopic: Record<string, OverlapResult> = {
      "Topic A": { status: "linked_existing", courseId: "crs_existing", branch: "fresh_high_score", reason: "r" },
      "Topic B": { status: "delta_needed", branch: "angle_mismatch", reason: "r" },
    };

    const roadmap = await runOverlapDetectionForPath(pathId, {
      db,
      resolveOverlapForTopic: async (topicName) => resultsByTopic[topicName]!,
    });

    expect(roadmap.find((t) => t.topicName === "Topic A")).toMatchObject({ status: "linked_existing", courseId: "crs_existing" });
    expect(roadmap.find((t) => t.topicName === "Topic B")).toMatchObject({ status: "delta_needed", courseId: null });

    const [rowA] = await db.select().from(pathTopics).where(eq(pathTopics.id, "pt_a"));
    expect(rowA!.status).toBe("linked_existing");
    expect(rowA!.courseId).toBe("crs_existing");
  });

  it("throws PathPlannerError for an unknown path id", async () => {
    const db = await getDb(":memory:");
    await expect(runOverlapDetectionForPath("does-not-exist", { db })).rejects.toThrow(PathPlannerError);
  });
});

// ---------------------------------------------------------------------------
// Deliverable 4: the ordering guard + on-demand generation
// ---------------------------------------------------------------------------

function checkTopic(id: string, order: number, parallelGroup: string, status: GeneratableCheckTopic["status"]): GeneratableCheckTopic {
  return { id, order, parallelGroup, status };
}

describe("isTopicGeneratable", () => {
  it("a tier-0 pending topic with no blockers is generatable", () => {
    const all = [checkTopic("a", 0, "tier_0", "pending")];
    expect(isTopicGeneratable(all[0]!, all)).toBe(true);
  });

  it("a tier-1 topic is blocked while a tier-0 topic is still pending", () => {
    const all = [checkTopic("a", 0, "tier_0", "pending"), checkTopic("b", 1, "tier_1", "pending")];
    expect(isTopicGeneratable(all[1]!, all)).toBe(false);
  });

  it("a tier-1 topic becomes generatable once every tier-0 topic is linked_existing", () => {
    const all = [checkTopic("a", 0, "tier_0", "linked_existing"), checkTopic("b", 1, "tier_1", "pending")];
    expect(isTopicGeneratable(all[1]!, all)).toBe(true);
  });

  it("topics sharing a parallelGroup never block each other, even if one is still pending", () => {
    const all = [checkTopic("a", 0, "tier_0", "pending"), checkTopic("b", 0, "tier_0", "pending")];
    expect(isTopicGeneratable(all[1]!, all)).toBe(true);
  });

  it("a topic that's already linked_existing/mastered/in_progress is not itself generatable", () => {
    const linked = checkTopic("a", 0, "tier_0", "linked_existing");
    const mastered = checkTopic("b", 0, "tier_0", "mastered");
    const inProgress = checkTopic("c", 0, "tier_0", "in_progress");
    const all = [linked, mastered, inProgress];
    expect(isTopicGeneratable(linked, all)).toBe(false);
    expect(isTopicGeneratable(mastered, all)).toBe(false);
    expect(isTopicGeneratable(inProgress, all)).toBe(false);
  });

  it("a delta_needed topic is generatable once its tier is unblocked", () => {
    const all = [checkTopic("a", 0, "tier_0", "linked_existing"), checkTopic("b", 1, "tier_1", "delta_needed")];
    expect(isTopicGeneratable(all[1]!, all)).toBe(true);
  });
});

function makeMockPipeline(db: TeacherDb) {
  const capturedTopics: string[] = [];
  const capturedGoalContexts: Array<string | undefined> = [];
  const generateMindMapCalls: string[] = [];
  const runResearchPipelineFn = async (topic: string, options?: RunResearchPipelineOptions): Promise<CourseJson> => {
    capturedTopics.push(topic);
    capturedGoalContexts.push(options?.goalContext);
    return { topic, prerequisites: [], subtopics: [], generatedAt: new Date().toISOString(), coverageStatus: "complete" };
  };
  // Mirrors what the real buildCourse() does — inserts a real courses row, since pathTopics.courseId has a real FK to it.
  const buildCourseFn = async (course: CourseJson): Promise<BuildCourseResult> => {
    const courseId = "crs_generated_1";
    await db.insert(courses).values({
      id: courseId,
      topic: course.topic,
      createdAt: course.generatedAt,
      volatilityTier: "medium",
      status: "building",
      goalContext: course.goalContext ?? null,
    });
    return { courseId, moduleCount: 2, lessonCount: 4, subtopicLessonMap: {} };
  };
  const aggregateMaterialsFn = async () => ({ sourceCount: 0, backfillTriggeredCount: 0, belowThresholdLessonCount: 0 });
  // Mocked the same way as the other three injected steps — without this, generateTopicCourse's
  // real default (a genuine orchestrator.run() call) would fire during every test above.
  const generateMindMapFn = async (courseId: string): Promise<GenerateMindMapResult> => {
    generateMindMapCalls.push(courseId);
    return { courseId, graph: { nodes: [], edges: [] } };
  };
  return {
    capturedTopics,
    capturedGoalContexts,
    generateMindMapCalls,
    runResearchPipelineFn,
    buildCourseFn,
    aggregateMaterialsFn,
    generateMindMapFn,
  };
}

describe("generateTopicCourse", () => {
  beforeEach(() => {
    resetDbCache();
  });

  it("generates a pending topic, sets course_id and status linked_existing, and passes goalContext through unchanged (not delta-framed)", async () => {
    const db = await getDb(":memory:");
    await seedPathDirectly(db, [{ id: "pt_a", name: "Linear Algebra", order: 0, parallelGroup: "tier_0" }]);
    const mocks = makeMockPipeline(db);

    const result = await generateTopicCourse("pt_a", { db, ...mocks });

    expect(result).toEqual({ courseId: "crs_generated_1", moduleCount: 2, lessonCount: 4, wasDelta: false });
    expect(mocks.capturedTopics[0]).toBe("Linear Algebra"); // full pipeline: unmodified topic name
    expect(mocks.capturedGoalContexts[0]).toContain("Goal X");

    const [row] = await db.select().from(pathTopics).where(eq(pathTopics.id, "pt_a"));
    expect(row!.status).toBe("linked_existing");
    expect(row!.courseId).toBe("crs_generated_1");
  });

  it("frames a delta_needed topic narrowly (gap-scoped topic string) and marks wasDelta true", async () => {
    const db = await getDb(":memory:");
    await seedPathDirectly(db, [
      { id: "pt_a", name: "Linear Algebra", order: 0, parallelGroup: "tier_0", status: "delta_needed" },
    ]);
    const mocks = makeMockPipeline(db);

    const result = await generateTopicCourse("pt_a", { db, ...mocks });

    expect(result.wasDelta).toBe(true);
    expect(mocks.capturedTopics[0]).not.toBe("Linear Algebra"); // narrowly reframed, not the bare topic name
    expect(mocks.capturedTopics[0]).toContain("Linear Algebra");
    expect(mocks.capturedTopics[0]).toContain("emphasis");

    const [row] = await db.select().from(pathTopics).where(eq(pathTopics.id, "pt_a"));
    expect(row!.status).toBe("linked_existing");
  });

  it("refuses to generate a topic blocked by an earlier, unfinished tier (throws PathPlannerError, no mutation)", async () => {
    const db = await getDb(":memory:");
    await seedPathDirectly(db, [
      { id: "pt_a", name: "Topic A", order: 0, parallelGroup: "tier_0" }, // still pending — blocks tier 1
      { id: "pt_b", name: "Topic B", order: 1, parallelGroup: "tier_1" },
    ]);
    const mocks = makeMockPipeline(db);

    await expect(generateTopicCourse("pt_b", { db, ...mocks })).rejects.toThrow(PathPlannerError);
    expect(mocks.capturedTopics).toHaveLength(0); // never even started the pipeline

    const [row] = await db.select().from(pathTopics).where(eq(pathTopics.id, "pt_b"));
    expect(row!.status).toBe("pending"); // unchanged
  });

  it("throws PathPlannerError for an unknown PathTopic id", async () => {
    const db = await getDb(":memory:");
    const mocks = makeMockPipeline(db);
    await expect(generateTopicCourse("does-not-exist", { db, ...mocks })).rejects.toThrow(PathPlannerError);
  });

  it("generates a mind map for the newly built course as a 4th step, mirroring build-stream's chain", async () => {
    const db = await getDb(":memory:");
    await seedPathDirectly(db, [{ id: "pt_a", name: "Linear Algebra", order: 0, parallelGroup: "tier_0" }]);
    const mocks = makeMockPipeline(db);

    const result = await generateTopicCourse("pt_a", { db, ...mocks });

    expect(mocks.generateMindMapCalls).toEqual([result.courseId]);
  });

  it("degrades (logs, does not throw) when mind map generation fails — the course is still built and linked", async () => {
    const db = await getDb(":memory:");
    await seedPathDirectly(db, [{ id: "pt_a", name: "Linear Algebra", order: 0, parallelGroup: "tier_0" }]);
    const mocks = makeMockPipeline(db);
    const progressMessages: string[] = [];
    const failingGenerateMindMapFn = async (): Promise<GenerateMindMapResult> => {
      throw new Error("mind map LLM call failed");
    };

    const result = await generateTopicCourse("pt_a", {
      db,
      ...mocks,
      generateMindMapFn: failingGenerateMindMapFn,
      onProgress: (message) => progressMessages.push(message),
    });

    expect(result.courseId).toBe("crs_generated_1");
    const [row] = await db.select().from(pathTopics).where(eq(pathTopics.id, "pt_a"));
    expect(row!.status).toBe("linked_existing"); // course generation still completed and linked
    expect(progressMessages.some((m) => m.includes("Mind map generation failed"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Shared roadmap read path
// ---------------------------------------------------------------------------

describe("loadPathRoadmap", () => {
  beforeEach(() => {
    resetDbCache();
  });

  it("returns topics ordered by tier with their domain name resolved", async () => {
    const db = await getDb(":memory:");
    const { pathId } = await seedPathDirectly(db, [
      { id: "pt_b", name: "Topic B", order: 1, parallelGroup: "tier_1" },
      { id: "pt_a", name: "Topic A", order: 0, parallelGroup: "tier_0" },
    ]);
    const roadmap = await loadPathRoadmap(pathId, { db });
    expect(roadmap.map((t) => t.topicName)).toEqual(["Topic A", "Topic B"]);
    expect(roadmap[0]!.domainName).toBe("Domain A");
  });
});
