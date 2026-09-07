import { eq, inArray } from "drizzle-orm";
import { run as orchestratorRun } from "../orchestrator/index.js";
import type { AnswerLessonQuestionOutput, AnswerLessonQuestionSourceRef } from "../orchestrator/templates/answerLessonQuestion.js";
import { createCitationValidator } from "../research/grounding.js";
import { getDb, type TeacherDb } from "../db/client.js";
import { lessons, sources, modules, normalizeSourceRefEntry } from "../db/schema.js";
import { recordActivityEvent as recordActivityEventDefault } from "../motivation/index.js";

export type OrchestratorRunFn = typeof orchestratorRun;
export type RecordActivityEventFn = typeof recordActivityEventDefault;

export class TeachingEngineError extends Error {}

/** Per-source character cap fed into the prompt — same truncation reasoning as research/pipeline.ts's toSourceExcerpt. */
const MAX_SOURCE_TEXT_CHARS = 2000;

export interface AnswerLessonQuestionOptions {
  /** Injectable for tests. Default: the real orchestrator.run(). */
  orchestratorRun?: OrchestratorRunFn;
  /** Injectable for tests. Default: getDb() (real, migrated SQLite at data/teacher.db). */
  db?: TeacherDb;
  /** Injectable for tests. Default: the real motivation.recordActivityEvent() (Phase 9). */
  recordActivityEvent?: RecordActivityEventFn;
}

export interface AnswerLessonQuestionResult extends AnswerLessonQuestionOutput {
  lessonId: string;
}

/**
 * Phase 7's Lesson/Teaching screen: the one genuinely missing backend piece — text-question Q&A
 * grounded strictly in that lesson's own persisted content. Loads the lesson's real layers plus
 * its actual linked sources (lessons.sourceRefs -> sources table, the same join the Course view
 * uses for citation display), routes through the Orchestrator like every other [LLM] step in this
 * codebase, and enforces the returned sourceIds are a real subset via createCitationValidator
 * (src/research/grounding.ts) — reused unchanged, not reimplemented.
 */
export async function answerLessonQuestion(
  lessonId: string,
  question: string,
  options: AnswerLessonQuestionOptions = {}
): Promise<AnswerLessonQuestionResult> {
  const run = options.orchestratorRun ?? orchestratorRun;
  const db = options.db ?? (await getDb());
  const recordActivity = options.recordActivityEvent ?? recordActivityEventDefault;

  const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId));
  if (!lesson) throw new TeachingEngineError(`No lesson found with id "${lessonId}".`);

  const sourceIds = [...new Set(lesson.sourceRefs.map(normalizeSourceRefEntry).map((r) => r.sourceId))];
  const sourceRows = sourceIds.length > 0 ? await db.select().from(sources).where(inArray(sources.id, sourceIds)) : [];
  const sourceRefs: AnswerLessonQuestionSourceRef[] = sourceRows.map((s) => ({
    source_id: s.id,
    title: s.url,
    text:
      s.extractedText.length > MAX_SOURCE_TEXT_CHARS
        ? `${s.extractedText.slice(0, MAX_SOURCE_TEXT_CHARS)}\n...[truncated]`
        : s.extractedText,
  }));
  const validSourceIds = new Set(sourceRefs.map((s) => s.source_id));

  const result = await run<AnswerLessonQuestionOutput>(
    "answer_lesson_question",
    {
      lessonTitle: lesson.title,
      layers: {
        intuition: lesson.layers.intuition.text,
        mechanics: lesson.layers.mechanics.text,
        formal: lesson.layers.formal.text,
        application: lesson.layers.application.text,
        frontier: lesson.layers.frontier.text,
      },
      sources: sourceRefs,
      question,
    },
    "teaching-engine",
    {
      validateExtra: createCitationValidator(validSourceIds, (data) => (data as AnswerLessonQuestionOutput).sourceIds),
    }
  );

  const [mod] = await db.select().from(modules).where(eq(modules.id, lesson.moduleId));
  if (mod) {
    await recordActivity("lesson_question_asked", lessonId, mod.courseId, { db });
  }

  return { lessonId, ...result.data };
}
