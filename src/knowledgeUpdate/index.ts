import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { run as orchestratorRun } from "../orchestrator/index.js";
import type { GenerateRecheckQueriesOutput } from "../orchestrator/templates/generateRecheckQueries.js";
import {
  createCompareFindingsToFactsValidator,
  type CompareFindingsToFactsOutput,
} from "../orchestrator/templates/compareFindingsToFacts.js";
import type { GenerateUpdateLessonOutput } from "../orchestrator/templates/generateUpdateLesson.js";
import { getDb, type TeacherDb } from "../db/client.js";
import { courses, modules, lessons, updateEvents, lessonUpdates } from "../db/schema.js";
import { webSearch as webSearchDefault } from "../mcp/webSearch.js";
import type { SearchProvider } from "../mcp/webSearch.js";
import { fetchAndClean as fetchAndCleanDefault } from "../extraction/fetchAndClean.js";
import type { CleanedContent } from "../extraction/fetchAndClean.js";
import {
  getTopicHistory as getTopicHistoryDefault,
  supersedeFact as supersedeFactDefault,
} from "../memoryGraph/index.js";
import type { GraphitiFactResult } from "../memoryGraph/index.js";
import { getRecheckIntervalDays, type VolatilityTier } from "../shared/recheckInterval.js";
import { buildKnowledgeUpdatePushPayload, sendPushToAllSubscriptions as sendPushToAllSubscriptionsDefault } from "../push/index.js";

export type OrchestratorRunFn = typeof orchestratorRun;
export type ProgressListener = (message: string) => void;
export type FetchAndCleanFn = (url: string) => Promise<CleanedContent>;
export type GetTopicHistoryFn = typeof getTopicHistoryDefault;
export type SupersedeFactFn = typeof supersedeFactDefault;
export type SendPushToAllSubscriptionsFn = typeof sendPushToAllSubscriptionsDefault;

const MAX_FINDINGS = 5;

// ---------------------------------------------------------------------------
// Step 1 [code]: select topics due for recheck
// ---------------------------------------------------------------------------

export interface DueTopic {
  id: string;
  topic: string;
  volatilityTier: VolatilityTier;
  goalContext: string | null;
  lastChecked: string | null;
}

export interface GetDueTopicsOptions {
  db?: TeacherDb;
  now?: Date;
}

/**
 * Knowledge Update Agent (Phase 6) step 1: due = `last_checked` is null (never checked — always
 * due) OR older than `getRecheckIntervalDays(volatilityTier)` (src/shared/recheckInterval.ts, the
 * single formalized function Phase 5's overlap detection now shares). This is also what makes
 * `runKnowledgeUpdateAgent` idempotent — after a topic is checked, `lastChecked` is set to now, so
 * an immediate second run finds nothing due for it.
 */
export async function getDueTopics(options: GetDueTopicsOptions = {}): Promise<DueTopic[]> {
  const db = options.db ?? (await getDb());
  const now = options.now ?? new Date();

  const allCourses = await db.select().from(courses);
  return allCourses
    .filter((c) => {
      if (c.lastChecked === null) return true;
      const ageDays = (now.getTime() - new Date(c.lastChecked).getTime()) / 86_400_000;
      return ageDays > getRecheckIntervalDays(c.volatilityTier);
    })
    .map((c) => ({
      id: c.id,
      topic: c.topic,
      volatilityTier: c.volatilityTier,
      goalContext: c.goalContext,
      lastChecked: c.lastChecked,
    }));
}

// ---------------------------------------------------------------------------
// Step 2: check one due topic for updates
// ---------------------------------------------------------------------------

export interface CheckTopicForUpdatesOptions {
  db?: TeacherDb;
  orchestratorRun?: OrchestratorRunFn;
  searchProvider?: SearchProvider;
  fetchAndClean?: FetchAndCleanFn;
  getTopicHistory?: GetTopicHistoryFn;
  supersedeFact?: SupersedeFactFn;
  /** Injectable for tests. Default: the real Web Push send (src/push/index.ts, Phase 10). */
  sendPushToAllSubscriptions?: SendPushToAllSubscriptionsFn;
  onProgress?: ProgressListener;
}

export interface CheckTopicForUpdatesResult {
  events: (typeof updateEvents.$inferSelect)[];
  lessonUpdatesCreated: (typeof lessonUpdates.$inferSelect)[];
}

function dedupeByUrl<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Best-effort: recover the OLD fact's Graphiti edge uuid by matching the LLM's paraphrased summary against the real fact strings getTopicHistory() returned. Null when no confident match is found — never guessed. */
function findMatchingFactUuid(summary: string, facts: GraphitiFactResult[]): string | null {
  const normalizedSummary = normalizeForMatch(summary);
  const match = facts.find((f) => {
    const nf = normalizeForMatch(f.fact);
    return nf === normalizedSummary || nf.includes(normalizedSummary) || normalizedSummary.includes(nf);
  });
  return match?.uuid ?? null;
}

/**
 * Knowledge Update Agent (Phase 6) step 2, per due topic: `[LLM]` a lighter recheck-query set ->
 * `[MCP]` web_search + fetch_and_clean (Phase 2's own adapters, reused directly — NOT a full
 * researchPass()) -> `[LLM]` compare against existing Memory Graph facts, classifying each real
 * delta -> `[code]` write UpdateEvent rows; moderate/major also supersede the Memory Graph fact
 * (see src/memoryGraph/index.ts's supersedeFact); major also generates and persists a delta
 * "update lesson". Severity "none" (nothing actually changed) is never persisted.
 */
export async function checkTopicForUpdates(
  topic: DueTopic,
  options: CheckTopicForUpdatesOptions = {}
): Promise<CheckTopicForUpdatesResult> {
  const run = options.orchestratorRun ?? orchestratorRun;
  const db = options.db ?? (await getDb());
  const search = options.searchProvider ?? { search: webSearchDefault };
  const fetchAndClean = options.fetchAndClean ?? fetchAndCleanDefault;
  const getTopicHistory = options.getTopicHistory ?? getTopicHistoryDefault;
  const supersede = options.supersedeFact ?? supersedeFactDefault;
  const sendPush = options.sendPushToAllSubscriptions ?? sendPushToAllSubscriptionsDefault;
  const onProgress = options.onProgress;

  const courseModules = await db.select().from(modules).where(eq(modules.courseId, topic.id));
  const courseLessons: (typeof lessons.$inferSelect)[] = [];
  for (const m of courseModules) {
    courseLessons.push(...(await db.select().from(lessons).where(eq(lessons.moduleId, m.id))));
  }
  if (courseLessons.length === 0) {
    onProgress?.(`  "${topic.topic}" has no lessons yet — skipping.`);
    return { events: [], lessonUpdatesCreated: [] };
  }

  const history = await getTopicHistory(topic.topic);
  const existingFacts = history.facts.map((f) => f.fact);
  const existingFactsSummary =
    existingFacts.slice(0, 10).join(" | ") || `No prior facts recorded for "${topic.topic}" yet.`;

  onProgress?.(`Generating recheck queries for "${topic.topic}"...`);
  const queries = await run<GenerateRecheckQueriesOutput>(
    "generate_recheck_queries",
    { topic: topic.topic, existingFactsSummary },
    "knowledge-update-agent"
  );

  onProgress?.(`Searching for updates on "${topic.topic}"...`);
  const searchResults = dedupeByUrl(await search.search(queries.data.queries)).slice(0, MAX_FINDINGS);

  const findings: Array<{ title: string; url: string; text: string }> = [];
  for (const r of searchResults) {
    const cleaned = await fetchAndClean(r.url);
    if (cleaned.extractionConfidence > 0) {
      findings.push({ title: cleaned.title || r.title, url: r.url, text: cleaned.text.slice(0, 4000) });
    }
  }
  if (findings.length === 0) {
    onProgress?.(`  No usable fresh sources found for "${topic.topic}" — nothing to compare this run.`);
    return { events: [], lessonUpdatesCreated: [] };
  }

  const knownLessonIds = new Set(courseLessons.map((l) => l.id));
  onProgress?.(`Comparing ${findings.length} finding(s) against existing facts for "${topic.topic}"...`);
  const comparison = await run<CompareFindingsToFactsOutput>(
    "compare_findings_to_facts",
    {
      topic: topic.topic,
      existingFacts,
      newFindings: findings,
      lessons: courseLessons.map((l) => ({ id: l.id, title: l.title, description: l.description })),
    },
    "knowledge-update-agent",
    { validateExtra: createCompareFindingsToFactsValidator(knownLessonIds) }
  );

  const events: (typeof updateEvents.$inferSelect)[] = [];
  const createdLessonUpdates: (typeof lessonUpdates.$inferSelect)[] = [];
  const now = new Date().toISOString();

  for (const delta of comparison.data.deltas) {
    if (delta.severity === "none") continue;

    const eventId = `ue_${randomUUID()}`;
    const eventRow = {
      id: eventId,
      topicId: topic.id,
      detectedAt: now,
      severity: delta.severity,
      deltaSummary: delta.explanation,
      supersededFactRef: findMatchingFactUuid(delta.existingFactSummary, history.facts),
    };
    await db.insert(updateEvents).values(eventRow);
    events.push(eventRow);

    if (delta.severity === "minor") {
      // Silent log only, per the PRD's severity-based display rules — no digest entry, no graph write.
      onProgress?.(`  [minor] ${topic.topic}: ${delta.explanation}`);
      continue;
    }

    // moderate or major: real graph supersession — see supersedeFact's doc comment for why
    // add_triplet (not delete_entity_edge) is the correct Graphiti call here.
    await supersede(topic.topic, delta.existingFactSummary, delta.newFindingSummary);

    if (delta.severity === "moderate") {
      onProgress?.(`  [moderate] ${topic.topic}: ${delta.explanation}`);
      continue;
    }

    onProgress?.(`  [MAJOR] ${topic.topic}: ${delta.explanation}`);
    try {
      const pushResult = await sendPush(buildKnowledgeUpdatePushPayload({ topicName: topic.topic, deltaSummary: delta.explanation }), { db });
      onProgress?.(`  Push notification sent to ${pushResult.sent} device(s)${pushResult.removedStale > 0 ? ` (${pushResult.removedStale} stale subscription(s) removed)` : ""}.`);
    } catch (error) {
      onProgress?.(`  Push notification failed (not fatal to this run): ${(error as Error).message}`);
    }
    const relatedLesson = courseLessons.find((l) => l.id === delta.relatedLessonId)!;
    const updateLessonResult = await run<GenerateUpdateLessonOutput>(
      "generate_update_lesson",
      {
        lessonTitle: relatedLesson.title,
        existingFactSummary: delta.existingFactSummary,
        newFindingSummary: delta.newFindingSummary,
        explanation: delta.explanation,
      },
      "knowledge-update-agent"
    );
    const lessonUpdateRow = {
      id: `lu_${randomUUID()}`,
      lessonId: delta.relatedLessonId,
      updateEventId: eventId,
      title: updateLessonResult.data.title,
      whatChanged: updateLessonResult.data.whatChanged,
      updatedGuidance: updateLessonResult.data.updatedGuidance,
      createdAt: now,
    };
    await db.insert(lessonUpdates).values(lessonUpdateRow);
    createdLessonUpdates.push(lessonUpdateRow);
  }

  return { events, lessonUpdatesCreated: createdLessonUpdates };
}

// ---------------------------------------------------------------------------
// Orchestration: the standalone scheduled-job entrypoint
// ---------------------------------------------------------------------------

export interface RunKnowledgeUpdateAgentOptions {
  db?: TeacherDb;
  orchestratorRun?: OrchestratorRunFn;
  searchProvider?: SearchProvider;
  fetchAndClean?: FetchAndCleanFn;
  getTopicHistory?: GetTopicHistoryFn;
  supersedeFact?: SupersedeFactFn;
  sendPushToAllSubscriptions?: SendPushToAllSubscriptionsFn;
  now?: Date;
  onProgress?: ProgressListener;
}

export interface RunKnowledgeUpdateAgentResult {
  topicsChecked: number;
  eventsBySeverity: { minor: number; moderate: number; major: number };
}

/**
 * The full scheduled-job run (`npm run knowledge-update`). Loops every due topic, checks it, and
 * updates `courses.lastChecked` regardless of whether any delta was found — this alone is what
 * makes a second immediate run a genuine no-op (see getDueTopics above): nothing will be due again
 * until the interval elapses.
 */
export async function runKnowledgeUpdateAgent(
  options: RunKnowledgeUpdateAgentOptions = {}
): Promise<RunKnowledgeUpdateAgentResult> {
  const db = options.db ?? (await getDb());
  const onProgress = options.onProgress;

  const due = await getDueTopics({ db, now: options.now });
  const eventsBySeverity = { minor: 0, moderate: 0, major: 0 };

  if (due.length === 0) {
    onProgress?.("No topics are due for a recheck right now.");
    return { topicsChecked: 0, eventsBySeverity };
  }

  for (const topic of due) {
    onProgress?.(`Checking "${topic.topic}" for updates (last checked: ${topic.lastChecked ?? "never"})...`);
    const result = await checkTopicForUpdates(topic, {
      db,
      orchestratorRun: options.orchestratorRun,
      searchProvider: options.searchProvider,
      fetchAndClean: options.fetchAndClean,
      getTopicHistory: options.getTopicHistory,
      supersedeFact: options.supersedeFact,
      sendPushToAllSubscriptions: options.sendPushToAllSubscriptions,
      onProgress,
    });
    for (const event of result.events) eventsBySeverity[event.severity] += 1;
    await db.update(courses).set({ lastChecked: new Date().toISOString() }).where(eq(courses.id, topic.id));
  }

  return { topicsChecked: due.length, eventsBySeverity };
}

// ---------------------------------------------------------------------------
// The "what's new" digest
// ---------------------------------------------------------------------------

export interface WhatsNewDigestItem {
  id: string;
  topicId: string;
  topicName: string;
  severity: "minor" | "moderate" | "major";
  detectedAt: string;
  deltaSummary: string;
  lessonUpdate?: { title: string; whatChanged: string; updatedGuidance: string; lessonId: string };
}

export interface WhatsNewDigest {
  major: WhatsNewDigestItem[];
  moderate: WhatsNewDigestItem[];
  /** Always populated (minor items aren't dropped from the query) — the harness decides whether to print them, per the PRD's "available on request but not shown by default." */
  minor: WhatsNewDigestItem[];
}

export interface GetWhatsNewDigestOptions {
  db?: TeacherDb;
  /** How far back to include events. Default: 30 days. */
  sinceDays?: number;
}

/**
 * `[code]` query only — no LLM, no MCP. Pulls recent UpdateEvent rows (major joined with its
 * generated lessonUpdates row), grouped by severity, per the PRD's display rules: major flagged
 * prominently, moderate listed, minor available but not shown by default.
 */
export async function getWhatsNewDigest(options: GetWhatsNewDigestOptions = {}): Promise<WhatsNewDigest> {
  const db = options.db ?? (await getDb());
  const sinceDays = options.sinceDays ?? 30;
  const cutoff = new Date(Date.now() - sinceDays * 86_400_000).toISOString();

  const allEvents = await db.select().from(updateEvents);
  const recent = allEvents
    .filter((e) => e.detectedAt >= cutoff)
    .sort((a, b) => (b.detectedAt < a.detectedAt ? -1 : 1));

  const items: WhatsNewDigestItem[] = [];
  for (const e of recent) {
    const [course] = await db.select().from(courses).where(eq(courses.id, e.topicId));
    let lessonUpdate: WhatsNewDigestItem["lessonUpdate"];
    if (e.severity === "major") {
      const [lu] = await db.select().from(lessonUpdates).where(eq(lessonUpdates.updateEventId, e.id));
      if (lu) {
        lessonUpdate = { title: lu.title, whatChanged: lu.whatChanged, updatedGuidance: lu.updatedGuidance, lessonId: lu.lessonId };
      }
    }
    items.push({
      id: e.id,
      topicId: e.topicId,
      topicName: course?.topic ?? e.topicId,
      severity: e.severity,
      detectedAt: e.detectedAt,
      deltaSummary: e.deltaSummary,
      ...(lessonUpdate ? { lessonUpdate } : {}),
    });
  }

  return {
    major: items.filter((i) => i.severity === "major"),
    moderate: items.filter((i) => i.severity === "moderate"),
    minor: items.filter((i) => i.severity === "minor"),
  };
}
