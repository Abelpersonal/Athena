import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { run as orchestratorRun } from "../orchestrator/index.js";
import type { ClassifyTopicOrGoalOutput } from "../orchestrator/templates/classifyTopicOrGoal.js";
import {
  createDecomposeGoalIntoPathValidator,
  type DecomposeGoalIntoPathOutput,
} from "../orchestrator/templates/decomposeGoalIntoPath.js";
import {
  createDetermineCrossDomainDependenciesValidator,
  type DetermineCrossDomainDependenciesOutput,
  type CrossDomainTopicRef,
} from "../orchestrator/templates/determineCrossDomainDependencies.js";
import {
  computeCrossDomainOrder,
  partitionDomainsIntoPhases,
  PathPlannerError,
  type OrderableTopic,
} from "./ordering.js";
import {
  resolveOverlapForTopic as resolveOverlapForTopicDefault,
  type ResolveOverlapOptions,
} from "./overlap.js";
import { runResearchPipeline as runResearchPipelineDefault, type RunResearchPipelineOptions } from "../research/pipeline.js";
import type { CourseJson } from "../research/types.js";
import { buildCourse as buildCourseDefault, type BuildCourseOptions } from "../courseBuilder/index.js";
import { aggregateMaterials as aggregateMaterialsDefault, type AggregateMaterialsOptions } from "../materialAggregator/index.js";
import { generateMindMap as generateMindMapDefault } from "../mindMap/index.js";
import { getDb, type TeacherDb } from "../db/client.js";
import { paths, pathDomains, pathTopics } from "../db/schema.js";
import { assignUniqueIds } from "../shared/ids.js";

export { PathPlannerError, computeCrossDomainOrder } from "./ordering.js";
export type { OrderableTopic, OrderedTopic } from "./ordering.js";
export * from "./overlap.js";

export type OrchestratorRunFn = typeof orchestratorRun;
export type ProgressListener = (message: string) => void;
export type PathTopicStatus = "pending" | "linked_existing" | "delta_needed" | "in_progress" | "mastered";

/** Sanity-check warning threshold. */
const PATH_TOPIC_COUNT_WARNING_THRESHOLD = 40;
/**
 * A hard ceiling — 3x the warning threshold — beyond which the pipeline refuses to persist an
 * implausibly large path rather than silently proceeding. This IS a real hard cap (unlike the
 * warning threshold above, which stays log-only) — a genuinely broad goal that decomposes into
 * this many topics would run this many topics' worth of course generations, each its own
 * multi-call research pass, with no automatic circuit breaker otherwise. A second, structural
 * line of defense alongside the Orchestrator's own dollar cost cap (ORCHESTRATOR_SESSION_BUDGET_USD).
 */
const PATH_TOPIC_COUNT_HARD_LIMIT = PATH_TOPIC_COUNT_WARNING_THRESHOLD * 3;

function randomSuffix(): string {
  return randomBytes(3).toString("hex");
}

// ---------------------------------------------------------------------------
// Deliverable 1: classification
// ---------------------------------------------------------------------------

export interface ClassifyInputOptions {
  orchestratorRun?: OrchestratorRunFn;
}

/** [LLM] step only — the CLI harness is responsible for confirming this with the user before acting on it (never applied silently). */
export async function classifyInput(
  input: string,
  options: ClassifyInputOptions = {}
): Promise<ClassifyTopicOrGoalOutput> {
  const run = options.orchestratorRun ?? orchestratorRun;
  const result = await run<ClassifyTopicOrGoalOutput>("classify_topic_or_goal", { input }, "path-planner");
  return result.data;
}

// ---------------------------------------------------------------------------
// Deliverable 2: decomposition + cross-domain dependency mapping + persistence
// ---------------------------------------------------------------------------

export interface DecomposeAndPersistPathOptions {
  orchestratorRun?: OrchestratorRunFn;
  db?: TeacherDb;
  onProgress?: ProgressListener;
}

export interface PersistedPathResult {
  pathId: string;
  domainCount: number;
  topicCount: number;
}

export interface RawGoalDecompositionDomain {
  tempId: string;
  name: string;
}

export interface RawGoalDecompositionTopic {
  tempId: string;
  domainTempId: string;
  topicName: string;
  description: string;
  order: number;
  parallelGroup: string;
}

/**
 * Everything needed to persist a goal decomposition WITHOUT re-running either of its two [LLM]
 * calls — a fully plain, JSON-serializable snapshot (Graceful Over-Large-Goal Handling addition),
 * since whether/how to persist it (proceed as one Path / split into phased Paths / abort) is now a
 * SEPARATE decision the caller makes, mirroring classifyInput()'s own "the caller decides, never
 * applied silently" principle. `domainBreakdown` exists purely so a caller can show the user WHY a
 * decomposition is large — it isn't used for persistence itself.
 */
export interface RawGoalDecomposition {
  goalDescription: string;
  domains: RawGoalDecompositionDomain[];
  topics: RawGoalDecompositionTopic[];
  topicCount: number;
  hardLimit: number;
  domainBreakdown: Array<{ name: string; topicCount: number }>;
}

export type DecomposeGoalResult =
  | ({ outcome: "normal" } & RawGoalDecomposition)
  | ({ outcome: "oversized" } & RawGoalDecomposition);

export interface DecomposeGoalOptions {
  orchestratorRun?: OrchestratorRunFn;
  onProgress?: ProgressListener;
}

/**
 * Deliverable 2's two [LLM] steps (decompose into domains/topics, then determine cross-domain
 * dependency edges) plus the code-side ordering pass (computeCrossDomainOrder — never trusting the
 * model with the aggregate) — WITHOUT any persistence. Graceful Over-Large-Goal Handling addition:
 * this used to throw outright once topics.length reached PATH_TOPIC_COUNT_HARD_LIMIT; it no longer
 * does. It always returns the full, real decomposition — "oversized" is just a flag the caller
 * (the harness's `goal` command, `app/new`'s client flow) uses to decide what happens next (see
 * persistDecomposedGoal below), mirroring classifyInput()'s own "the caller decides, never applied
 * silently" principle. The original warning-only threshold (PATH_TOPIC_COUNT_WARNING_THRESHOLD)
 * still just logs, unchanged.
 */
export async function decomposeGoal(
  goalDescription: string,
  options: DecomposeGoalOptions = {}
): Promise<DecomposeGoalResult> {
  const run = options.orchestratorRun ?? orchestratorRun;
  const onProgress = options.onProgress;

  onProgress?.(`Decomposing goal into domains and topics: "${goalDescription}"...`);
  const decomposeResult = await run<DecomposeGoalIntoPathOutput>(
    "decompose_goal_into_path",
    { goalDescription },
    "path-planner",
    { validateExtra: createDecomposeGoalIntoPathValidator() }
  );
  const { domains, topics } = decomposeResult.data;

  if (topics.length >= PATH_TOPIC_COUNT_WARNING_THRESHOLD) {
    console.warn(
      `[path-planner] decompose_goal_into_path returned ${topics.length} topics for "${goalDescription}" — ` +
        "unusually large for a single roadmap."
    );
  }

  const domainNameByTempId = new Map(domains.map((d) => [d.tempId, d.name]));
  const topicRefs: CrossDomainTopicRef[] = topics.map((t) => ({
    tempId: t.tempId,
    domainTempId: t.domainTempId,
    domainName: domainNameByTempId.get(t.domainTempId) ?? t.domainTempId,
    topicName: t.topicName,
    description: t.description,
  }));
  const topicIdSet = new Set(topics.map((t) => t.tempId));

  onProgress?.(`Determining cross-domain prerequisite order for ${topics.length} topic(s)...`);
  const depsResult = await run<DetermineCrossDomainDependenciesOutput>(
    "determine_cross_domain_dependencies",
    { goalDescription, topics: topicRefs },
    "path-planner",
    { validateExtra: createDetermineCrossDomainDependenciesValidator(topicIdSet) }
  );
  const orderable: OrderableTopic[] = depsResult.data.dependencies.map((d) => ({
    tempId: d.topicTempId,
    dependsOnTempIds: d.dependsOnTempIds,
  }));
  const ordered = computeCrossDomainOrder(orderable);
  const orderByTempId = new Map(ordered.map((o) => [o.tempId, o]));

  const rawTopics: RawGoalDecompositionTopic[] = topics.map((t) => {
    const o = orderByTempId.get(t.tempId)!;
    return {
      tempId: t.tempId,
      domainTempId: t.domainTempId,
      topicName: t.topicName,
      description: t.description,
      order: o.order,
      parallelGroup: o.parallelGroup,
    };
  });

  const topicCountByDomain = new Map<string, number>();
  for (const t of rawTopics) {
    topicCountByDomain.set(t.domainTempId, (topicCountByDomain.get(t.domainTempId) ?? 0) + 1);
  }
  const domainBreakdown = domains.map((d) => ({
    name: d.name,
    topicCount: topicCountByDomain.get(d.tempId) ?? 0,
  }));

  const outcome: "normal" | "oversized" = topics.length >= PATH_TOPIC_COUNT_HARD_LIMIT ? "oversized" : "normal";
  if (outcome === "oversized") {
    onProgress?.(
      `Decomposition is unusually large (${topics.length} topics, hard ceiling is ` +
        `${PATH_TOPIC_COUNT_HARD_LIMIT}) — not persisting yet. The caller decides how to proceed ` +
        "(proceed as-is / split into phases / abort), never applied silently."
    );
  }

  return {
    outcome,
    goalDescription,
    domains: domains.map((d) => ({ tempId: d.tempId, name: d.name })),
    topics: rawTopics,
    topicCount: topics.length,
    hardLimit: PATH_TOPIC_COUNT_HARD_LIMIT,
    domainBreakdown,
  };
}

export interface PersistDecomposedGoalOptions {
  db?: TeacherDb;
  onProgress?: ProgressListener;
}

/**
 * Persists an already-decomposed goal (decomposeGoal's own output — no LLM calls happen here).
 * `action: "proceed"` persists the WHOLE decomposition as one Path, exactly like this function's
 * predecessor (the old decomposeAndPersistPath) always did. `action: "split"` (Graceful
 * Over-Large-Goal Handling addition) partitions the EXISTING domains into up to 3 sequential
 * phases along their own real prerequisite order (partitionDomainsIntoPhases, ordering.ts) —
 * never re-decomposing anything — and persists each phase as its own separate Path, so a user
 * facing a legitimately large goal gets a manageable, phased roadmap instead of one enormous Path
 * or an outright refusal. `action: "abort"` isn't a case here at all — the caller simply never
 * calls this function.
 */
export async function persistDecomposedGoal(
  decomposition: RawGoalDecomposition,
  action: "proceed" | "split",
  options: PersistDecomposedGoalOptions = {}
): Promise<PersistedPathResult[]> {
  const db = options.db ?? (await getDb());
  const onProgress = options.onProgress;

  const domainGroups: string[][] =
    action === "split"
      ? partitionDomainsIntoPhases(
          decomposition.domains.map((d) => d.tempId),
          decomposition.topics.map((t) => ({ domainTempId: t.domainTempId, order: t.order })),
          3
        )
      : [decomposition.domains.map((d) => d.tempId)];

  const results: PersistedPathResult[] = [];
  for (let phaseIndex = 0; phaseIndex < domainGroups.length; phaseIndex++) {
    const domainTempIds = new Set(domainGroups[phaseIndex]!);
    const phaseDomains = decomposition.domains.filter((d) => domainTempIds.has(d.tempId));
    const phaseTopics = decomposition.topics.filter((t) => domainTempIds.has(t.domainTempId));
    const phaseLabel = domainGroups.length > 1 ? ` — Phase ${phaseIndex + 1} of ${domainGroups.length}` : "";
    const goalDescriptionForPhase = `${decomposition.goalDescription}${phaseLabel}`;

    onProgress?.(
      `Persisting${phaseLabel ? ` phase ${phaseIndex + 1}/${domainGroups.length}` : " path"} ` +
        `(${phaseDomains.length} domain(s), ${phaseTopics.length} topic(s))...`
    );

    const runSuffix = randomSuffix();
    const pathId = `path_${assignUniqueIds([goalDescriptionForPhase], { fallback: "path" })[0]}_${runSuffix}`;
    const domainIds = assignUniqueIds(phaseDomains.map((d) => d.name), { prefix: "dom_", fallback: "domain" }).map(
      (id) => `${id}_${runSuffix}`
    );
    const tempIdToDomainId = new Map(phaseDomains.map((d, i) => [d.tempId, domainIds[i]!]));
    const topicIds = assignUniqueIds(phaseTopics.map((t) => t.topicName), { prefix: "pt_", fallback: "topic" }).map(
      (id) => `${id}_${runSuffix}`
    );

    await db.transaction(async (tx) => {
      await tx.insert(paths).values({
        id: pathId,
        goalDescription: goalDescriptionForPhase,
        createdAt: new Date().toISOString(),
        status: "active",
      });
      for (let i = 0; i < phaseDomains.length; i++) {
        await tx.insert(pathDomains).values({ id: domainIds[i]!, pathId, name: phaseDomains[i]!.name, order: i });
      }
      for (let i = 0; i < phaseTopics.length; i++) {
        const t = phaseTopics[i]!;
        await tx.insert(pathTopics).values({
          id: topicIds[i]!,
          pathId,
          domainId: tempIdToDomainId.get(t.domainTempId)!,
          topicName: t.topicName,
          description: t.description,
          order: t.order,
          parallelGroup: t.parallelGroup,
          courseId: null,
          status: "pending",
        });
      }
    });

    results.push({ pathId, domainCount: phaseDomains.length, topicCount: phaseTopics.length });
  }

  return results;
}

export type DecomposeAndPersistPathOutcome =
  | ({ outcome: "persisted" } & PersistedPathResult)
  | ({ outcome: "oversized" } & RawGoalDecomposition);

/**
 * Historical single-call convenience wrapper around decomposeGoal() + persistDecomposedGoal() —
 * still the right choice for the common case (well under the hard ceiling: decompose, then
 * persist immediately as one Path). Once a decomposition trips PATH_TOPIC_COUNT_HARD_LIMIT this no
 * longer refuses outright (Graceful Over-Large-Goal Handling addition) — it returns the raw
 * decomposition instead, unpersisted, for the caller to resolve via persistDecomposedGoal() with
 * an explicit "proceed" or "split" once the user has actually decided; "abort" means the caller
 * simply never calls persistDecomposedGoal() at all.
 */
export async function decomposeAndPersistPath(
  goalDescription: string,
  options: DecomposeAndPersistPathOptions = {}
): Promise<DecomposeAndPersistPathOutcome> {
  const decomposition = await decomposeGoal(goalDescription, options);
  if (decomposition.outcome === "oversized") {
    return decomposition;
  }
  const [persisted] = await persistDecomposedGoal(decomposition, "proceed", options);
  return { outcome: "persisted", ...persisted! };
}

// ---------------------------------------------------------------------------
// Roadmap read path — shared by the overlap pass and the on-demand generation loop
// ---------------------------------------------------------------------------

export interface PathTopicRoadmapEntry {
  id: string;
  domainName: string;
  topicName: string;
  description: string;
  order: number;
  parallelGroup: string;
  status: PathTopicStatus;
  courseId: string | null;
}

export interface LoadPathRoadmapOptions {
  db?: TeacherDb;
}

export async function loadPathRoadmap(
  pathId: string,
  options: LoadPathRoadmapOptions = {}
): Promise<PathTopicRoadmapEntry[]> {
  const db = options.db ?? (await getDb());
  const domainRows = await db.select().from(pathDomains).where(eq(pathDomains.pathId, pathId));
  const domainNameById = new Map(domainRows.map((d) => [d.id, d.name]));
  const topicRows = await db.select().from(pathTopics).where(eq(pathTopics.pathId, pathId)).orderBy(pathTopics.order);
  return topicRows.map((t) => ({
    id: t.id,
    domainName: domainNameById.get(t.domainId) ?? t.domainId,
    topicName: t.topicName,
    description: t.description,
    order: t.order,
    parallelGroup: t.parallelGroup,
    status: t.status,
    courseId: t.courseId,
  }));
}

// ---------------------------------------------------------------------------
// Deliverable 3: overlap detection
// ---------------------------------------------------------------------------

export interface RunOverlapDetectionOptions {
  db?: TeacherDb;
  /** Injectable for tests. Default: the real resolveOverlapForTopic() (SQLite + Memory Graph + a real quick_refresh_check LLM call when needed). */
  resolveOverlapForTopic?: (
    topicName: string,
    goalContext: string,
    options: ResolveOverlapOptions
  ) => ReturnType<typeof resolveOverlapForTopicDefault>;
  onProgress?: ProgressListener;
}

/**
 * Deliverable 3: for every PathTopic in the path, resolves and PERSISTS its
 * overlap status before any course generation happens, then returns the
 * annotated roadmap — the CLI harness prints this explicitly (never applies
 * any of these decisions silently), mirroring the PRD's UX requirement.
 */
export async function runOverlapDetectionForPath(
  pathId: string,
  options: RunOverlapDetectionOptions = {}
): Promise<PathTopicRoadmapEntry[]> {
  const db = options.db ?? (await getDb());
  const resolve = options.resolveOverlapForTopic ?? resolveOverlapForTopicDefault;
  const onProgress = options.onProgress;

  const [path] = await db.select().from(paths).where(eq(paths.id, pathId));
  if (!path) throw new PathPlannerError(`No path found with id "${pathId}".`);

  const topicRows = await db.select().from(pathTopics).where(eq(pathTopics.pathId, pathId));
  for (const topic of topicRows) {
    onProgress?.(`Checking overlap for "${topic.topicName}"...`);
    const result = await resolve(topic.topicName, path.goalDescription, { db });
    await db
      .update(pathTopics)
      .set({ status: result.status, courseId: result.courseId ?? null })
      .where(eq(pathTopics.id, topic.id));
    onProgress?.(`  -> ${result.status} (${result.branch}): ${result.reason}`);
  }

  return loadPathRoadmap(pathId, { db });
}

// ---------------------------------------------------------------------------
// Deliverable 4: on-demand generation
// ---------------------------------------------------------------------------

export interface GeneratableCheckTopic {
  id: string;
  order: number;
  parallelGroup: string;
  status: PathTopicStatus;
}

function isTopicSatisfied(topic: GeneratableCheckTopic): boolean {
  return topic.status === "linked_existing" || topic.status === "mastered";
}

/**
 * The pure ordering guard: a topic can be generated once every topic at a
 * STRICTLY LOWER tier (order) is satisfied, regardless of domain — topics
 * sharing this topic's parallelGroup (i.e. the same tier) never block it,
 * so any pending/delta_needed topic within the current tier is freely
 * pickable in any order. This is a tier-gated interpretation (clear the
 * whole tier before advancing), not raw per-edge gating — the schema
 * doesn't persist raw dependency edges past ordering time, only the derived
 * order/parallelGroup — see README for why this is the resolved design.
 */
export function isTopicGeneratable(topic: GeneratableCheckTopic, allTopics: GeneratableCheckTopic[]): boolean {
  if (topic.status !== "pending" && topic.status !== "delta_needed") return false;
  const blockers = allTopics.filter(
    (t) => t.id !== topic.id && t.order < topic.order && t.parallelGroup !== topic.parallelGroup
  );
  return blockers.every(isTopicSatisfied);
}

export interface GenerateTopicCourseOptions {
  db?: TeacherDb;
  runResearchPipelineFn?: typeof runResearchPipelineDefault;
  buildCourseFn?: typeof buildCourseDefault;
  aggregateMaterialsFn?: typeof aggregateMaterialsDefault;
  /** Injectable for tests. Default: the real generateMindMap() (src/mindMap/index.ts). */
  generateMindMapFn?: typeof generateMindMapDefault;
  onProgress?: ProgressListener;
  /** Pass-throughs for --dry-run/testing — forwarded into runResearchPipeline/buildCourse/aggregateMaterials exactly like build --dry-run does. */
  orchestratorRun?: RunResearchPipelineOptions["orchestratorRun"];
  searchProvider?: RunResearchPipelineOptions["searchProvider"];
  fetchAndClean?: RunResearchPipelineOptions["fetchAndClean"];
  backfillSubtopic?: AggregateMaterialsOptions["backfillSubtopic"];
}

export interface GenerateTopicCourseResult {
  courseId: string;
  moduleCount: number;
  lessonCount: number;
  /** true if this ran the narrow delta framing (topic was delta_needed) rather than the full pipeline. */
  wasDelta: boolean;
}

/**
 * Deliverable 4: generates (or, for a delta_needed topic, targets a narrow
 * delta on) one PathTopic's course by running the EXISTING Phase 2 -> 3 ->
 * 3.5 pipeline with goalContext set to this path/domain's framing, then
 * updates the PathTopic's course_id and status. Re-checks
 * isTopicGeneratable() itself (defense in depth — the harness only ever
 * offers generatable topics, but this guards the function directly too) and
 * throws PathPlannerError rather than silently generating out of order.
 *
 * Delta scope (PRD open question, resolved): kept narrow by PROMPT framing
 * — the topic string handed to runResearchPipeline explicitly asks for just
 * the emphasis gap, not a fresh full decomposition of the whole topic —
 * rather than a structurally separate narrow-mode code path. This reuses
 * the Research Agent's existing pipeline entirely unchanged in code, which
 * also keeps this well inside the "don't rewrite the Research Agent" guardrail.
 */
export async function generateTopicCourse(
  pathTopicId: string,
  options: GenerateTopicCourseOptions = {}
): Promise<GenerateTopicCourseResult> {
  const db = options.db ?? (await getDb());
  const runResearchPipelineFn = options.runResearchPipelineFn ?? runResearchPipelineDefault;
  const buildCourseFn = options.buildCourseFn ?? buildCourseDefault;
  const aggregateMaterialsFn = options.aggregateMaterialsFn ?? aggregateMaterialsDefault;
  const generateMindMapFn = options.generateMindMapFn ?? generateMindMapDefault;
  const onProgress = options.onProgress;

  const [topic] = await db.select().from(pathTopics).where(eq(pathTopics.id, pathTopicId));
  if (!topic) throw new PathPlannerError(`No PathTopic found with id "${pathTopicId}".`);

  const allTopics = await db.select().from(pathTopics).where(eq(pathTopics.pathId, topic.pathId));
  if (!isTopicGeneratable(topic, allTopics)) {
    throw new PathPlannerError(
      `PathTopic "${topic.topicName}" (${pathTopicId}) is not generatable yet — either it's not pending/delta_needed, ` +
        "or a sequential prerequisite topic at an earlier tier isn't done yet."
    );
  }

  const [path] = await db.select().from(paths).where(eq(paths.id, topic.pathId));
  const [domain] = await db.select().from(pathDomains).where(eq(pathDomains.id, topic.domainId));
  if (!path || !domain) throw new PathPlannerError(`PathTopic "${pathTopicId}" is missing its path or domain row.`);

  await db.update(pathTopics).set({ status: "in_progress" }).where(eq(pathTopics.id, pathTopicId));

  const isDelta = topic.status === "delta_needed";
  const topicString = isDelta
    ? `${topic.topicName} — additional depth specifically for the goal "${path.goalDescription}" (${domain.name} domain), beyond what's already covered generically. Focus tightly on the emphasis/application gap for this goal, not a full re-teach of fundamentals covered elsewhere.`
    : topic.topicName;
  const goalContext = isDelta
    ? `Goal: "${path.goalDescription}". Domain: "${domain.name}". TARGETED DELTA on "${topic.topicName}": ${topic.description}. Cover only the goal-specific emphasis gap, not a full re-teach.`
    : `Goal: "${path.goalDescription}". Domain: "${domain.name}". Topic: "${topic.topicName}" — ${topic.description}`;

  onProgress?.(`Generating ${isDelta ? "a targeted delta course" : "a course"} for "${topic.topicName}"...`);
  const course: CourseJson = await runResearchPipelineFn(topicString, {
    goalContext,
    ...(isDelta ? { maxAuditRetries: 0 } : {}),
    onProgress,
    orchestratorRun: options.orchestratorRun,
    searchProvider: options.searchProvider,
    fetchAndClean: options.fetchAndClean,
  });

  const buildOptions: BuildCourseOptions = { db, onProgress, orchestratorRun: options.orchestratorRun };
  const built = await buildCourseFn(course, buildOptions);

  const aggregateOptions: AggregateMaterialsOptions = {
    db,
    onProgress,
    fetchAndClean: options.fetchAndClean,
    backfillSubtopic: options.backfillSubtopic,
  };
  await aggregateMaterialsFn(built.courseId, course, built.subtopicLessonMap, aggregateOptions);

  // Mirrors build-stream/route.ts's exact 4th-step call site (Phase 8) — a mind map failure
  // degrades (logged, course generation still completes) rather than failing the whole
  // generation; without this, every goal-path-generated course (the PRD's own primary example)
  // silently never got a mind map, even though the standalone /new topic flow already did.
  try {
    await generateMindMapFn(built.courseId, { db, onProgress, orchestratorRun: options.orchestratorRun });
  } catch (error) {
    onProgress?.(`Mind map generation failed (course was still built successfully): ${(error as Error).message}`);
  }

  await db
    .update(pathTopics)
    .set({ status: "linked_existing", courseId: built.courseId })
    .where(eq(pathTopics.id, pathTopicId));

  return { courseId: built.courseId, moduleCount: built.moduleCount, lessonCount: built.lessonCount, wasDelta: isDelta };
}
