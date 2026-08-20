import { randomUUID } from "node:crypto";
import { eq, isNotNull } from "drizzle-orm";
import { run as orchestratorRun } from "../orchestrator/index.js";
import type { GenerateBookCandidatesOutput } from "../orchestrator/templates/generateBookCandidates.js";
import type { InferCourseDomainOutput } from "../orchestrator/templates/inferCourseDomain.js";
import type { GenerateNextTopicSuggestionsOutput } from "../orchestrator/templates/generateNextTopicSuggestions.js";
import { getDb, type TeacherDb } from "../db/client.js";
import { courses, modules, lessons, books, pathTopics, pathDomains } from "../db/schema.js";
import {
  getTopicHistory as getTopicHistoryDefault,
  getCrossCourseConnections as getCrossCourseConnectionsDefault,
} from "../memoryGraph/index.js";
import type { TopicHistoryResult } from "../memoryGraph/index.js";
import { openLibrarySearch as openLibrarySearchDefault } from "../mcp/openLibrary.js";
import type { OpenLibraryBookResult } from "../mcp/openLibrary.js";
import { gutenbergCheck as gutenbergCheckDefault } from "../mcp/gutenberg.js";

export class ContinuousLearningError extends Error {}

export type OrchestratorRunFn = typeof orchestratorRun;
export type ProgressListener = (message: string) => void;
export type GetTopicHistoryFn = typeof getTopicHistoryDefault;
export type GetCrossCourseConnectionsFn = typeof getCrossCourseConnectionsDefault;
export type SearchOpenLibraryFn = typeof openLibrarySearchDefault;
export type CheckGutenbergFn = typeof gutenbergCheckDefault;

// ---------------------------------------------------------------------------
// Step 1 [code]: pull topic, mastery data, and full learning history
// ---------------------------------------------------------------------------

export interface CourseCompletionContext {
  course: typeof courses.$inferSelect;
  lessons: (typeof lessons.$inferSelect)[];
  topicHistory: TopicHistoryResult;
  /** A short summary of what the course actually covered, grounding every LLM step below. */
  courseSummary: string;
}

export interface GetCourseCompletionContextOptions {
  db?: TeacherDb;
  getTopicHistory?: GetTopicHistoryFn;
}

/**
 * Continuous Learning Agent (Phase 6) step 1. Also the trigger guard: throws
 * ContinuousLearningError when the course isn't complete yet ("course marked complete, not
 * mid-course" — the phase's explicit trigger condition), so this agent can never run against a
 * partially-finished course even if called directly.
 */
export async function getCourseCompletionContext(
  courseId: string,
  options: GetCourseCompletionContextOptions = {}
): Promise<CourseCompletionContext> {
  const db = options.db ?? (await getDb());
  const getTopicHistory = options.getTopicHistory ?? getTopicHistoryDefault;

  const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
  if (!course) throw new ContinuousLearningError(`No course found with id "${courseId}".`);
  if (course.completedAt === null) {
    throw new ContinuousLearningError(
      `Course "${courseId}" is not complete yet — the Continuous Learning Agent only runs on course completion, not mid-course.`
    );
  }

  const courseModules = await db.select().from(modules).where(eq(modules.courseId, courseId));
  const courseLessons: (typeof lessons.$inferSelect)[] = [];
  for (const m of courseModules) {
    courseLessons.push(...(await db.select().from(lessons).where(eq(lessons.moduleId, m.id))));
  }

  const topicHistory = await getTopicHistory(course.topic);
  const courseSummary =
    courseLessons.map((l) => `${l.title}: ${l.description}`).join(" | ") || `A course on "${course.topic}".`;

  return { course, lessons: courseLessons, topicHistory, courseSummary };
}

// ---------------------------------------------------------------------------
// Step 2 [LLM + MCP]: book recommendations
// ---------------------------------------------------------------------------

export interface BookCandidateFields {
  title: string;
  author: string;
  category: "core" | "optional_deep_dive" | "primary_source";
  rationale: string;
}
export interface PersistedBook extends BookCandidateFields {
  id: string;
  openLibraryWorkId?: string;
  gutenbergUrl?: string;
}
export interface RejectedBookCandidate extends BookCandidateFields {
  reason: string;
}
export interface GenerateBookRecommendationsResult {
  persisted: PersistedBook[];
  rejected: RejectedBookCandidate[];
}

export interface GenerateBookRecommendationsOptions {
  db?: TeacherDb;
  orchestratorRun?: OrchestratorRunFn;
  searchOpenLibrary?: SearchOpenLibraryFn;
  checkGutenberg?: CheckGutenbergFn;
  onProgress?: ProgressListener;
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findVerifiedMatch(candidateTitle: string, results: OpenLibraryBookResult[]): OpenLibraryBookResult | null {
  const normalizedCandidate = normalizeForMatch(candidateTitle);
  return (
    results.find((r) => {
      const nr = normalizeForMatch(r.title);
      return nr === normalizedCandidate || nr.includes(normalizedCandidate) || normalizedCandidate.includes(nr);
    }) ?? null
  );
}

/**
 * Continuous Learning Agent (Phase 6) step 2: `[LLM]` identify candidate titles ->
 * `[MCP]` verify each via Open Library (existence/current edition) and Gutenberg (legitimate free
 * full text, when it exists) -> `[code]` persist only VERIFIED candidates to the `books` table
 * (`status: "suggested"`). A candidate the model names that Open Library can't confirm is dropped
 * (returned in `rejected`, never persisted) — this is what makes "not hallucinated titles" a real
 * guarantee rather than a hope.
 */
export async function generateBookRecommendations(
  courseId: string,
  context: CourseCompletionContext,
  options: GenerateBookRecommendationsOptions = {}
): Promise<GenerateBookRecommendationsResult> {
  const run = options.orchestratorRun ?? orchestratorRun;
  const db = options.db ?? (await getDb());
  const searchOpenLibrary = options.searchOpenLibrary ?? openLibrarySearchDefault;
  const checkGutenberg = options.checkGutenberg ?? gutenbergCheckDefault;
  const onProgress = options.onProgress;

  onProgress?.(`Generating book candidates for "${context.course.topic}"...`);
  const result = await run<GenerateBookCandidatesOutput>(
    "generate_book_candidates",
    {
      topic: context.course.topic,
      goalContext: context.course.goalContext ?? undefined,
      courseSummary: context.courseSummary,
    },
    "continuous-learning-agent"
  );

  const persisted: PersistedBook[] = [];
  const rejected: RejectedBookCandidate[] = [];
  const now = new Date().toISOString();

  for (const candidate of result.data.candidates) {
    onProgress?.(`Verifying "${candidate.title}" by ${candidate.author} via Open Library...`);
    const matches = await searchOpenLibrary(candidate.title, candidate.author);
    const verified = findVerifiedMatch(candidate.title, matches);

    if (!verified) {
      onProgress?.(`  "${candidate.title}" could not be verified on Open Library — dropping (not persisted).`);
      rejected.push({
        ...candidate,
        reason: "Not found on Open Library — could not verify a real, current edition exists.",
      });
      continue;
    }

    const gutenberg = await checkGutenberg(candidate.title, candidate.author);
    if (gutenberg) {
      onProgress?.(`  "${candidate.title}" has a legitimate free full text on Project Gutenberg: ${gutenberg.url}`);
    }

    const id = `book_${randomUUID()}`;
    await db.insert(books).values({
      id,
      title: candidate.title,
      author: candidate.author,
      relatedTopicId: courseId,
      status: "suggested",
      category: candidate.category,
      openLibraryWorkId: verified.workId ?? null,
      gutenbergUrl: gutenberg?.url ?? null,
      createdAt: now,
    });
    persisted.push({
      ...candidate,
      id,
      ...(verified.workId ? { openLibraryWorkId: verified.workId } : {}),
      ...(gutenberg ? { gutenbergUrl: gutenberg.url } : {}),
    });
  }

  return { persisted, rejected };
}

// ---------------------------------------------------------------------------
// Step 3 [code]: recent topic pattern / diversity check
// ---------------------------------------------------------------------------

export const DEFAULT_DIVERSITY_WINDOW_N = Number(process.env.DIVERSITY_WINDOW_N ?? 5);
export const DEFAULT_DIVERSITY_CLUSTER_THRESHOLD = Number(process.env.DIVERSITY_CLUSTER_THRESHOLD ?? 0.6);
/** Below this many recently-completed courses, there's not enough data to call a pattern "narrow" without false-positiving on a fresh install. */
export const DEFAULT_DIVERSITY_MIN_SAMPLE = 3;

/**
 * Pure — no DB, no LLM — so every threshold is directly unit-testable. Narrow ("bias the branch
 * suggestion") when at least `minSample` domains are available AND the single most common domain's
 * share is `>= threshold`.
 */
export function isDomainClusterNarrow(
  domains: string[],
  threshold: number = DEFAULT_DIVERSITY_CLUSTER_THRESHOLD,
  minSample: number = DEFAULT_DIVERSITY_MIN_SAMPLE
): boolean {
  if (domains.length < minSample) return false;
  const counts = new Map<string, number>();
  for (const d of domains) {
    const key = d.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const maxCount = Math.max(...counts.values());
  return maxCount / domains.length >= threshold;
}

export interface GetRecentCourseDomainsOptions {
  db?: TeacherDb;
  orchestratorRun?: OrchestratorRunFn;
  n?: number;
  excludeCourseId?: string;
}

/**
 * Domains are computed FRESH every call, never persisted — same statelessness philosophy as the
 * suggestions themselves (see runContinuousLearningAgent's doc comment). Path-linked courses read
 * their real PathDomain; standalone courses get a lightweight `infer_course_domain` `[LLM]` tag.
 */
export async function getRecentCourseDomains(options: GetRecentCourseDomainsOptions = {}): Promise<string[]> {
  const db = options.db ?? (await getDb());
  const run = options.orchestratorRun ?? orchestratorRun;
  const n = options.n ?? DEFAULT_DIVERSITY_WINDOW_N;

  const completedCourses = await db.select().from(courses).where(isNotNull(courses.completedAt));
  const recent = completedCourses
    .filter((c) => c.id !== options.excludeCourseId)
    .sort((a, b) => (b.completedAt! < a.completedAt! ? -1 : 1))
    .slice(0, n);

  const domains: string[] = [];
  for (const c of recent) {
    const [linkedTopic] = await db.select().from(pathTopics).where(eq(pathTopics.courseId, c.id));
    if (linkedTopic) {
      const [domain] = await db.select().from(pathDomains).where(eq(pathDomains.id, linkedTopic.domainId));
      domains.push(domain?.name ?? c.topic);
      continue;
    }
    const inferred = await run<InferCourseDomainOutput>("infer_course_domain", { topic: c.topic }, "continuous-learning-agent");
    domains.push(inferred.data.domain);
  }
  return domains;
}

// ---------------------------------------------------------------------------
// Step 4 [LLM]: next-topic suggestions (deepen + branch)
// ---------------------------------------------------------------------------

export interface GenerateNextTopicSuggestionsResult extends GenerateNextTopicSuggestionsOutput {
  diversityBiasApplied: boolean;
  recentDomains: string[];
  crossCourseConnections: string[];
}

export interface GenerateNextTopicSuggestionsOptions {
  db?: TeacherDb;
  orchestratorRun?: OrchestratorRunFn;
  getCrossCourseConnections?: GetCrossCourseConnectionsFn;
  diversityWindowN?: number;
  onProgress?: ProgressListener;
}

/**
 * Continuous Learning Agent (Phase 6) step 3 (diversity check, folded in here since it's a direct
 * input to this call) + step 4: print-only, per the "statelessness" decision — nothing here is
 * persisted (see README, "Statelessness decision").
 */
export async function generateNextTopicSuggestions(
  courseId: string,
  context: CourseCompletionContext,
  options: GenerateNextTopicSuggestionsOptions = {}
): Promise<GenerateNextTopicSuggestionsResult> {
  const run = options.orchestratorRun ?? orchestratorRun;
  const getCrossCourseConnections = options.getCrossCourseConnections ?? getCrossCourseConnectionsDefault;
  const onProgress = options.onProgress;

  onProgress?.("Checking cross-course connections in the Memory Graph...");
  const connections = await getCrossCourseConnections(context.course.topic);

  onProgress?.("Checking recent-topic diversity...");
  const recentDomains = await getRecentCourseDomains({
    db: options.db,
    orchestratorRun: run,
    n: options.diversityWindowN,
    excludeCourseId: courseId,
  });
  const diversityBiasApplied = isDomainClusterNarrow(recentDomains);
  if (diversityBiasApplied) {
    onProgress?.(`Recent topics cluster narrowly in: ${recentDomains.join(", ")} — biasing the branch suggestion toward diversity.`);
  }

  const result = await run<GenerateNextTopicSuggestionsOutput>(
    "generate_next_topic_suggestions",
    {
      topic: context.course.topic,
      goalContext: context.course.goalContext ?? undefined,
      courseSummary: context.courseSummary,
      crossCourseConnections: connections.connectedTopics,
      diversityBiasNeeded: diversityBiasApplied,
      recentDomains,
    },
    "continuous-learning-agent"
  );

  return {
    ...result.data,
    diversityBiasApplied,
    recentDomains,
    crossCourseConnections: connections.connectedTopics,
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface RunContinuousLearningAgentOptions {
  db?: TeacherDb;
  orchestratorRun?: OrchestratorRunFn;
  getTopicHistory?: GetTopicHistoryFn;
  getCrossCourseConnections?: GetCrossCourseConnectionsFn;
  searchOpenLibrary?: SearchOpenLibraryFn;
  checkGutenberg?: CheckGutenbergFn;
  diversityWindowN?: number;
  onProgress?: ProgressListener;
}

export interface RunContinuousLearningAgentResult {
  course: typeof courses.$inferSelect;
  books: GenerateBookRecommendationsResult;
  topicSuggestions: GenerateNextTopicSuggestionsResult;
}

/**
 * The Continuous Learning Agent's full run — what `npm run harness -- suggest <course_id>` calls.
 * Trigger: a course marked complete (guarded by getCourseCompletionContext, step 1). Book
 * candidates are PERSISTED (status "suggested"); topic suggestions are PRINT-ONLY, recomputed
 * fresh every run — a deliberate v1 simplification (see README, "Statelessness decision"): there's
 * no Dashboard yet to make stale suggestions a real problem, so a Suggestion table/lifecycle would
 * be designing ahead of an actual consumer.
 */
export async function runContinuousLearningAgent(
  courseId: string,
  options: RunContinuousLearningAgentOptions = {}
): Promise<RunContinuousLearningAgentResult> {
  const db = options.db ?? (await getDb());
  const context = await getCourseCompletionContext(courseId, { db, getTopicHistory: options.getTopicHistory });

  const books = await generateBookRecommendations(courseId, context, {
    db,
    orchestratorRun: options.orchestratorRun,
    searchOpenLibrary: options.searchOpenLibrary,
    checkGutenberg: options.checkGutenberg,
    onProgress: options.onProgress,
  });

  const topicSuggestions = await generateNextTopicSuggestions(courseId, context, {
    db,
    orchestratorRun: options.orchestratorRun,
    getCrossCourseConnections: options.getCrossCourseConnections,
    diversityWindowN: options.diversityWindowN,
    onProgress: options.onProgress,
  });

  return { course: context.course, books, topicSuggestions };
}
