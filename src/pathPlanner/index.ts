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
import { computeCrossDomainOrder, PathPlannerError, type OrderableTopic } from "./ordering.js";
import {
  resolveOverlapForTopic as resolveOverlapForTopicDefault,
  type ResolveOverlapOptions,
} from "./overlap.js";
import { runResearchPipeline as runResearchPipelineDefault, type RunResearchPipelineOptions } from "../research/pipeline.js";
import type { CourseJson } from "../research/types.js";
import { buildCourse as buildCourseDefault, type BuildCourseOptions } from "../courseBuilder/index.js";
import { aggregateMaterials as aggregateMaterialsDefault, type AggregateMaterialsOptions } from "../materialAggregator/index.js";
import { getDb, type TeacherDb } from "../db/client.js";
import { paths, pathDomains, pathTopics } from "../db/schema.js";
import { assignUniqueIds } from "../shared/ids.js";

export { PathPlannerError, computeCrossDomainOrder } from "./ordering.js";
export type { OrderableTopic, OrderedTopic } from "./ordering.js";
export * from "./overlap.js";

export type OrchestratorRunFn = typeof orchestratorRun;
export type ProgressListener = (message: string) => void;
export type PathTopicStatus = "pending" | "linked_existing" | "delta_needed" | "in_progress" | "mastered";

/** Sanity-check only (not a hard cap) — this is a personal tool, not a system that needs to protect itself from its own user. */
const PATH_TOPIC_COUNT_WARNING_THRESHOLD = 40;

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

/**
 * Runs both of Deliverable 2's [LLM] steps (decompose into domains/topics,
 * then determine cross-domain dependency edges), turns the raw edges into
 * actual tiers/parallel groups via computeCrossDomainOrder() (code, no LLM
 * trusted with the aggregate), and persists Path/PathDomain/PathTopic rows
 * with course_id null and status "pending" for every topic — overlap
 * detection (runOverlapDetectionForPath) runs as a separate pass afterward.
 */
export async function decomposeAndPersistPath(
  goalDescription: string,
  options: DecomposeAndPersistPathOptions = {}
): Promise<PersistedPathResult> {
  const run = options.orchestratorRun ?? orchestratorRun;
  const db = options.db ?? (await getDb());
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
        "unusually large for a single roadmap. Proceeding anyway (sanity check, not a hard cap)."
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

  const runSuffix = randomSuffix();
  const pathId = `path_${assignUniqueIds([goalDescription], { fallback: "path" })[0]}_${runSuffix}`;
  const domainIds = assignUniqueIds(domains.map((d) => d.name), { prefix: "dom_", fallback: "domain" }).map(
    (id) => `${id}_${runSuffix}`
  );
  const tempIdToDomainId = new Map(domains.map((d, i) => [d.tempId, domainIds[i]!]));
  const topicIds = assignUniqueIds(topics.map((t) => t.topicName), { prefix: "pt_", fallback: "topic" }).map(
    (id) => `${id}_${runSuffix}`
  );

  onProgress?.(`Persisting path (${domains.length} domain(s), ${topics.length} topic(s))...`);
  await db.transaction(async (tx) => {
    await tx.insert(paths).values({ id: pathId, goalDescription, createdAt: new Date().toISOString(), status: "active" });
    for (let i = 0; i < domains.length; i++) {
      await tx.insert(pathDomains).values({ id: domainIds[i]!, pathId, name: domains[i]!.name, order: i });
    }
    for (let i = 0; i < topics.length; i++) {
      const t = topics[i]!;
      const o = orderByTempId.get(t.tempId)!;
      await tx.insert(pathTopics).values({
        id: topicIds[i]!,
        pathId,
        domainId: tempIdToDomainId.get(t.domainTempId)!,
        topicName: t.topicName,
        description: t.description,
        order: o.order,
        parallelGroup: o.parallelGroup,
        courseId: null,
        status: "pending",
      });
    }
  });

  return { pathId, domainCount: domains.length, topicCount: topics.length };
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

  await db
    .update(pathTopics)
    .set({ status: "linked_existing", courseId: built.courseId })
    .where(eq(pathTopics.id, pathTopicId));

  return { courseId: built.courseId, moduleCount: built.moduleCount, lessonCount: built.lessonCount, wasDelta: isDelta };
}
