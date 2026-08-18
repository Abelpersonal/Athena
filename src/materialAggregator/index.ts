import { eq } from "drizzle-orm";
import { fetchAndClean as fetchAndCleanDefault } from "../extraction/fetchAndClean.js";
import type { FetchAndCleanFn, BackfillSubtopicOptions } from "../research/pipeline.js";
import { backfillSubtopic as backfillSubtopicDefault } from "../research/pipeline.js";
import { getDb, type TeacherDb } from "../db/client.js";
import { lessons, sources as sourcesTable, courses } from "../db/schema.js";
import type { CourseJson, SourceRecord } from "../research/types.js";
import type { SourceType } from "../extraction/fetchAndClean.js";
import { writeSubtopicFacts as writeSubtopicFactsDefault } from "../memoryGraph/index.js";

export type ProgressListener = (message: string) => void;
export type BackfillSubtopicFn = (
  input: Parameters<typeof backfillSubtopicDefault>[0],
  options?: BackfillSubtopicOptions
) => ReturnType<typeof backfillSubtopicDefault>;
export type WriteSubtopicFactsFn = typeof writeSubtopicFactsDefault;

/** Minimum valid (type === "article") sources a lesson needs before it ships without a backfill flag. Configurable per the Phase 3 "open questions" default. */
const DEFAULT_MIN_VALID_SOURCES = Number(process.env.MATERIAL_MIN_VALID_SOURCES ?? 2);

export interface AggregateMaterialsOptions {
  /** Injectable for tests. Default: the real fetchAndClean(). */
  fetchAndClean?: FetchAndCleanFn;
  /** Injectable for tests — mock this to avoid burning real API/search calls in CI. Default: the real researchAgent.backfillSubtopic(). */
  backfillSubtopic?: BackfillSubtopicFn;
  /** Injectable for tests. Default: getDb() (real, migrated SQLite at data/teacher.db). */
  db?: TeacherDb;
  /** Injectable for tests. Default: the real memoryGraph.writeSubtopicFacts() (Phase 3.5). */
  writeSubtopicFacts?: WriteSubtopicFactsFn;
  minValidSources?: number;
  onProgress?: ProgressListener;
}

export interface AggregateMaterialsResult {
  sourceCount: number;
  backfillTriggeredCount: number;
  belowThresholdLessonCount: number;
}

interface PersistableSource {
  id: string;
  url: string;
  type: SourceType;
  text: string;
  confidence: number;
}

/**
 * Phase 3's Material Aggregator. Input is the source list Phase 2's research
 * pass already collected per subtopic (fetched once ephemerally) plus the
 * subtopic->lesson id map buildCourse() just produced. This stage re-fetches
 * every source (verify-still-reachable + re-fetch, not a reuse of Phase 2's
 * in-memory text) to produce the PERSISTED, lesson-linked copy, then flags
 * and backfills any lesson that lands below the valid-source threshold.
 * No LLM calls in this module's own code — the one exception is delegating
 * to researchAgent.backfillSubtopic(), which does call the Orchestrator
 * (generate_search_queries etc.) as part of its narrow re-run of Phase 2's
 * search+extract steps; that's the deliberate, spec'd reach-back into the
 * Research Agent, not a violation of the "no LLM calls" rule for this file.
 */
export async function aggregateMaterials(
  courseId: string,
  course: CourseJson,
  subtopicLessonMap: Record<string, string>,
  options: AggregateMaterialsOptions = {}
): Promise<AggregateMaterialsResult> {
  const fetchAndClean = options.fetchAndClean ?? fetchAndCleanDefault;
  const backfill = options.backfillSubtopic ?? backfillSubtopicDefault;
  const db = options.db ?? (await getDb());
  const writeFacts = options.writeSubtopicFacts ?? writeSubtopicFactsDefault;
  const minValidSources = options.minValidSources ?? DEFAULT_MIN_VALID_SOURCES;
  const onProgress = options.onProgress;

  let sourceCount = 0;
  let backfillTriggeredCount = 0;
  let belowThresholdLessonCount = 0;

  for (const subtopic of course.subtopics) {
    const lessonId = subtopicLessonMap[subtopic.id];
    if (!lessonId) {
      onProgress?.(`  no lesson found for subtopic "${subtopic.title}" — skipping (should not happen).`);
      continue;
    }

    onProgress?.(`Aggregating materials for "${subtopic.title}"...`);
    let persisted = await refetchAndPersist(subtopic.sources, fetchAndClean, db, onProgress);
    let validCount = countValid(persisted);

    if (validCount < minValidSources) {
      const gap = `Only ${validCount} valid source(s) were found for this lesson; need at least ${minValidSources}.`;
      onProgress?.(`  "${subtopic.title}" has ${validCount} valid source(s) (< ${minValidSources}) — triggering one targeted backfill.`);
      backfillTriggeredCount += 1;

      const backfillSources = await backfill({
        topic: course.topic,
        subtopicTitle: subtopic.title,
        subtopicDescription: subtopic.description,
        gapInstruction: gap,
      });
      onProgress?.(`  backfill for "${subtopic.title}" found ${backfillSources.length} additional source(s).`);
      const newlyPersisted = await persistBackfillSources(backfillSources, db);
      persisted = dedupeById([...persisted, ...newlyPersisted]);
      validCount = countValid(persisted);

      if (validCount < minValidSources) {
        onProgress?.(`  "${subtopic.title}" still below threshold after backfill (${validCount}) — shipping flagged as below_threshold.`);
        belowThresholdLessonCount += 1;
      }
    }

    await db
      .update(lessons)
      .set({
        sourceRefs: persisted.map((p) => p.id),
        sourceStatus: validCount < minValidSources ? "below_threshold" : "ok",
      })
      .where(eq(lessons.id, lessonId));

    sourceCount += persisted.length;

    // Phase 3.5: write this subtopic's grounded key points to the Memory Graph now that
    // their source_ids are persisted, real ids (not just Phase 2's ephemeral ones).
    await writeFacts(courseId, subtopic.id, subtopic.keyPoints);
  }

  await db.update(courses).set({ status: "complete" }).where(eq(courses.id, courseId));

  return { sourceCount, backfillTriggeredCount, belowThresholdLessonCount };
}

function countValid(list: PersistableSource[]): number {
  return list.filter((p) => p.type === "article").length;
}

async function refetchAndPersist(
  sourceRecords: SourceRecord[],
  fetchAndClean: FetchAndCleanFn,
  db: TeacherDb,
  onProgress?: ProgressListener
): Promise<PersistableSource[]> {
  const out: PersistableSource[] = [];
  for (const record of sourceRecords) {
    const cleaned = await fetchAndClean(record.url);
    if (cleaned.sourceType !== "article") {
      onProgress?.(`  ${record.url} re-fetched as "${cleaned.sourceType}" — not counted as a valid source.`);
    }
    const persistable: PersistableSource = {
      id: record.source_id,
      url: record.url,
      type: cleaned.sourceType,
      text: cleaned.text,
      confidence: cleaned.extractionConfidence,
    };
    await insertSource(db, persistable);
    out.push(persistable);
  }
  return out;
}

/**
 * Backfill's own fetchAndClean already ran as part of gatherSources() (and
 * already dropped anything below the confidence floor) — every SourceRecord
 * it returns is by construction a usable "article", so these are persisted
 * directly rather than fetched a third time.
 */
async function persistBackfillSources(sourceRecords: SourceRecord[], db: TeacherDb): Promise<PersistableSource[]> {
  const out: PersistableSource[] = [];
  for (const record of sourceRecords) {
    const persistable: PersistableSource = {
      id: record.source_id,
      url: record.url,
      type: "article",
      text: record.text,
      confidence: record.extractionConfidence,
    };
    await insertSource(db, persistable);
    out.push(persistable);
  }
  return out;
}

/**
 * source_id is a content hash of the URL (see mcp/webSearch.ts), so the same
 * real URL always maps to the same id — a repeat across subtopics, a
 * backfill re-discovering something the initial pass already found, or a
 * later `build` run over a DB that already has this URL cached are all
 * expected, not bugs. onConflictDoNothing() keeps those idempotent instead
 * of throwing a UNIQUE constraint error.
 */
async function insertSource(db: TeacherDb, s: PersistableSource): Promise<void> {
  await db
    .insert(sourcesTable)
    .values({
      id: s.id,
      url: s.url,
      type: s.type,
      extractedText: s.text,
      credibilityScore: s.confidence,
      fetchedAt: new Date().toISOString(),
    })
    .onConflictDoNothing();
}

function dedupeById(list: PersistableSource[]): PersistableSource[] {
  const seen = new Map<string, PersistableSource>();
  for (const item of list) {
    if (!seen.has(item.id)) seen.set(item.id, item);
  }
  return [...seen.values()];
}
