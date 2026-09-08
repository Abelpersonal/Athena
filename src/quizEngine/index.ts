import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { run as orchestratorRun } from "../orchestrator/index.js";
import type { QuizQuestionsOutput } from "../orchestrator/templates/generateRecallQuestions.js";
import type { ScoreFreeTextAnswerOutput } from "../orchestrator/templates/scoreFreeTextAnswer.js";
import { getDb, type TeacherDb } from "../db/client.js";
import { lessons, modules, courses, quizResults, masteryState } from "../db/schema.js";
import { writeMasteryUpdate as writeMasteryUpdateDefault } from "../memoryGraph/index.js";
import { recordActivityEvent as recordActivityEventDefault } from "../motivation/index.js";
import { DEFAULT_HIGH_SCORE_THRESHOLD } from "../pathPlanner/overlap.js";

export type OrchestratorRunFn = typeof orchestratorRun;
export type ProgressListener = (message: string) => void;
export type WriteMasteryUpdateFn = typeof writeMasteryUpdateDefault;
export type RecordActivityEventFn = typeof recordActivityEventDefault;

export class QuizEngineError extends Error {}

export type QuizTier = "recall" | "application" | "transfer";
export const ALL_QUIZ_TIERS: QuizTier[] = ["recall", "application", "transfer"];

export interface MultipleChoiceQuestion {
  id: string;
  tier: QuizTier;
  type: "multiple_choice";
  prompt: string;
  options: string[];
  correctOptionIndex: number;
}
export interface FreeTextQuestion {
  id: string;
  tier: QuizTier;
  type: "free_text";
  prompt: string;
  rubric: string;
}
export type QuizQuestion = MultipleChoiceQuestion | FreeTextQuestion;

export interface QuizAnswer {
  questionId: string;
  /** Selected option index (0-based) for multiple_choice questions, the raw typed text for free_text ones. */
  answer: string | number;
}

export interface QuizQuestionResult {
  questionId: string;
  tier: QuizTier;
  /** 0-1 continuous — objective questions score exactly 0 or 1, free-text questions are semantically graded. */
  score: number;
  explanation?: string;
}

export interface QuizSessionResult {
  lessonId: string;
  /** Only the tiers actually tested this session. */
  tierScores: Partial<Record<QuizTier, number>>;
  /** Average across every question answered this session, all tiers combined — this is what becomes MasteryState.knowledgeScore. */
  overallScore: number;
  questionResults: QuizQuestionResult[];
  /** [] or [lessonId] under the current concept_node_id = lesson_id granularity — see README. */
  weakConceptNodes: string[];
  masteryState: { conceptNodeId: string; knowledgeScore: number | null; experienceScore: number | null; lastUpdated: string };
  /**
   * Phase 6: set to the course id ONLY when THIS quiz session is what just flipped
   * courses.completedAt from null — i.e. every lesson in the course now has a QuizResult across
   * all three tiers, and it didn't before this session. undefined otherwise (course already
   * complete, or still incomplete). See checkAndMarkCourseCompletion below.
   */
  courseCompleted?: string;
  /**
   * Phase 9, Deliverable 5: true when THIS session's transfer-tier score is at/above the "high
   * score" bar — reusing Phase 5's DEFAULT_HIGH_SCORE_THRESHOLD (0.75, src/pathPlanner/overlap.ts)
   * rather than inventing a third threshold, per the Phase 9 kickoff's explicit instruction. One
   * of exactly two real milestone-celebration triggers (the other is courseCompleted above) — a
   * routine below-threshold result, or a session with no transfer-tier questions, is false.
   */
  transferHighScoreAchieved: boolean;
}

/** 0-1 continuous score scale for both knowledgeScore and experienceScore (resolved default, see README). */
export const DEFAULT_QUESTIONS_PER_TIER = Number(process.env.QUIZ_QUESTIONS_PER_TIER ?? 2);
/** Below this knowledge_score, a concept node is surfaced as a weak-concept candidate (not load-bearing yet — see README). */
export const DEFAULT_WEAK_CONCEPT_THRESHOLD = Number(process.env.QUIZ_WEAK_CONCEPT_THRESHOLD ?? 0.6);

/**
 * Phase 9's milestone-trigger pure logic, extracted for direct unit testing (see the Phase 9
 * kickoff's "milestone-trigger conditions... as pure-function tests" requirement) — a session's
 * transfer-tier score just crossed the same "high score" bar Phase 5's overlap detection already
 * uses for "well-mastered."
 */
export function isTransferHighScoreAchieved(
  tierScores: Partial<Record<QuizTier, number>>,
  threshold: number = DEFAULT_HIGH_SCORE_THRESHOLD
): boolean {
  return tierScores.transfer !== undefined && tierScores.transfer >= threshold;
}

const TASK_TYPE_BY_TIER: Record<QuizTier, string> = {
  recall: "generate_recall_questions",
  application: "generate_application_questions",
  transfer: "generate_transfer_questions",
};

export interface QuizEngineOptions {
  /** Injectable for tests. Default: the real orchestrator.run(). */
  orchestratorRun?: OrchestratorRunFn;
  /** Injectable for tests. Default: getDb() (real, migrated SQLite at data/teacher.db). */
  db?: TeacherDb;
  /** Injectable for tests. Default: the real memoryGraph.writeMasteryUpdate() (Phase 4). */
  writeMasteryUpdate?: WriteMasteryUpdateFn;
  /** Injectable for tests. Default: the real motivation.recordActivityEvent() (Phase 9). */
  recordActivityEvent?: RecordActivityEventFn;
  questionsPerTier?: number;
  weakConceptThreshold?: number;
  /** Client-generated (a UUID minted once when the quiz attempt starts — see components/QuizClient.tsx), reused verbatim on a retry. Undefined for any caller that predates this (CLI/harness, older clients) — scoreAndRecordQuiz() then behaves exactly as it always did, with no dedup at all. */
  idempotencyKey?: string;
  onProgress?: ProgressListener;
}

async function loadLesson(db: TeacherDb, lessonId: string) {
  const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId));
  if (!lesson) throw new QuizEngineError(`No lesson found with id "${lessonId}".`);
  return lesson;
}

/**
 * Quiz Engine step 1: [LLM] generate questions per requested tier, grounded
 * in the lesson's own persisted content (title, description, and its five
 * layers, pulled from the Lesson record Phase 3's Course Builder wrote) —
 * never generic, ungrounded question generation. One registered template
 * per tier (generate_recall_questions / generate_application_questions /
 * generate_transfer_questions), per the PRD.
 */
export async function generateQuizQuestions(
  lessonId: string,
  tiers: QuizTier[] = ALL_QUIZ_TIERS,
  options: QuizEngineOptions = {}
): Promise<QuizQuestion[]> {
  const run = options.orchestratorRun ?? orchestratorRun;
  const db = options.db ?? (await getDb());
  const questionsPerTier = options.questionsPerTier ?? DEFAULT_QUESTIONS_PER_TIER;
  const onProgress = options.onProgress;

  const lesson = await loadLesson(db, lessonId);

  const questions: QuizQuestion[] = [];
  for (const tier of tiers) {
    onProgress?.(`Generating ${questionsPerTier} ${tier}-tier question(s) for "${lesson.title}"...`);
    const result = await run<QuizQuestionsOutput>(
      TASK_TYPE_BY_TIER[tier],
      {
        lessonTitle: lesson.title,
        lessonDescription: lesson.description,
        layers: lesson.layers,
        numQuestions: questionsPerTier,
      },
      "quiz-engine"
    );
    for (const q of result.data.questions) {
      questions.push(
        q.type === "multiple_choice"
          ? {
              id: randomUUID(),
              tier,
              type: "multiple_choice",
              prompt: q.prompt,
              options: q.options,
              correctOptionIndex: q.correctOptionIndex,
            }
          : { id: randomUUID(), tier, type: "free_text", prompt: q.prompt, rubric: q.rubric }
      );
    }
  }
  return questions;
}

/**
 * Phase 6: the completion trigger. Default: a course is complete once every lesson under it has
 * at least one QuizResult across all three tiers (recall/application/transfer) — checked after
 * each quiz submission (called from scoreAndRecordQuiz below), not on a manual flag. Returns the
 * course id ONLY when this call is what just flipped it (courses.completedAt was null and is now
 * set) — an already-complete course, or one still missing tier coverage on some lesson, returns
 * null. This is what actually fires the Continuous Learning Agent's trigger (see
 * src/continuousLearning/index.ts) — `npm run harness -- suggest <course_id>` is still a manual
 * invocation in v1 (no Motivation Layer/notifications yet — see the Phase 6 scope boundary), but
 * the trigger condition itself is real, not a stub.
 */
export async function checkAndMarkCourseCompletion(lessonId: string, db: TeacherDb): Promise<string | null> {
  const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId));
  if (!lesson) return null;
  const [module] = await db.select().from(modules).where(eq(modules.id, lesson.moduleId));
  if (!module) return null;
  const [course] = await db.select().from(courses).where(eq(courses.id, module.courseId));
  if (!course || course.completedAt !== null) return null;

  const courseModules = await db.select().from(modules).where(eq(modules.courseId, course.id));
  const courseLessons: (typeof lessons.$inferSelect)[] = [];
  for (const m of courseModules) {
    courseLessons.push(...(await db.select().from(lessons).where(eq(lessons.moduleId, m.id))));
  }
  if (courseLessons.length === 0) return null;

  for (const l of courseLessons) {
    const rows = await db.select().from(quizResults).where(eq(quizResults.lessonId, l.id));
    const tiersCovered = new Set(rows.map((r) => r.tier));
    if (!ALL_QUIZ_TIERS.every((tier) => tiersCovered.has(tier))) return null;
  }

  const now = new Date().toISOString();
  await db.update(courses).set({ completedAt: now }).where(eq(courses.id, course.id));
  return course.id;
}

/**
 * Quiz Engine steps 3-5: score every answer — objective questions in code,
 * free-text questions via a semantic (not keyword-match) Orchestrator call —
 * write one QuizResult row per tier tested, update
 * MasteryState.knowledgeScore (an upsert that targets ONLY that column, so a
 * quiz run never touches experienceScore), mirror the update into the
 * Memory Graph as a new dated fact, and surface any weak concept node.
 *
 * SSRF Guard + Idempotent Sync Endpoints addition: `idempotencyKey` (optional — undefined for
 * every direct/CLI caller that predates this, exactly today's behavior) is checked BEFORE any
 * scoring happens — including the real, billed `score_free_text_answer` LLM call — since Phase
 * 10's offline outbox retries this exact route on reconnect, and a request that already succeeded
 * server-side but lost its response client-side must not be re-scored (real API cost) or
 * re-recorded (a duplicate QuizResult row, a double-fired ActivityEvent, a double-triggered
 * milestone/course-completion check) on that retry. A genuine duplicate returns the ORIGINAL
 * aggregate outcome — `tierScores`/`overallScore`/`masteryState`/`transferHighScoreAchieved` are
 * all real, exactly reconstructed from what's actually persisted. `questionResults` (per-question
 * detail with free-text explanations) is the one field NOT reconstructable this way — it was never
 * persisted anywhere, by original design — so a reconstructed duplicate returns `[]` for it rather
 * than guessing; the aggregate outcome this whole mechanism protects is still fully correct.
 * `courseCompleted` is always `undefined` on a reconstructed duplicate: that event, if any, already
 * fired on the original request — a retry must not re-report (or re-trigger) it.
 */
export async function scoreAndRecordQuiz(
  lessonId: string,
  questions: QuizQuestion[],
  answers: QuizAnswer[],
  options: QuizEngineOptions = {}
): Promise<QuizSessionResult> {
  const run = options.orchestratorRun ?? orchestratorRun;
  const db = options.db ?? (await getDb());
  const writeMastery = options.writeMasteryUpdate ?? writeMasteryUpdateDefault;
  const recordActivity = options.recordActivityEvent ?? recordActivityEventDefault;
  const weakThreshold = options.weakConceptThreshold ?? DEFAULT_WEAK_CONCEPT_THRESHOLD;
  const onProgress = options.onProgress;
  const idempotencyKey = options.idempotencyKey;

  if (idempotencyKey) {
    const existing = await db.select().from(quizResults).where(eq(quizResults.idempotencyKey, idempotencyKey));
    if (existing.length > 0) {
      onProgress?.(`Duplicate submission (idempotency key already recorded) for lesson ${lessonId} — returning the original result.`);
      const tierScores: Partial<Record<QuizTier, number>> = {};
      for (const row of existing) tierScores[row.tier] = row.score;
      const [existingMastery] = await db.select().from(masteryState).where(eq(masteryState.conceptNodeId, lessonId));
      const overallScore = existingMastery?.knowledgeScore ?? 0;
      return {
        lessonId,
        tierScores,
        overallScore,
        questionResults: [],
        weakConceptNodes: overallScore < weakThreshold ? [lessonId] : [],
        masteryState: existingMastery ?? { conceptNodeId: lessonId, knowledgeScore: null, experienceScore: null, lastUpdated: "" },
        transferHighScoreAchieved: isTransferHighScoreAchieved(tierScores),
      };
    }
  }

  const answerByQuestionId = new Map(answers.map((a) => [a.questionId, a.answer]));
  const questionResults: QuizQuestionResult[] = [];

  for (const q of questions) {
    const answer = answerByQuestionId.get(q.id);
    if (q.type === "multiple_choice") {
      const selected = typeof answer === "number" ? answer : Number(answer);
      questionResults.push({ questionId: q.id, tier: q.tier, score: selected === q.correctOptionIndex ? 1 : 0 });
    } else {
      const userAnswer = typeof answer === "string" ? answer : "";
      onProgress?.(`Scoring free-text answer for: "${q.prompt.slice(0, 60)}${q.prompt.length > 60 ? "..." : ""}"`);
      const result = await run<ScoreFreeTextAnswerOutput>(
        "score_free_text_answer",
        { questionPrompt: q.prompt, rubric: q.rubric, userAnswer },
        "quiz-engine"
      );
      questionResults.push({
        questionId: q.id,
        tier: q.tier,
        score: result.data.score,
        explanation: result.data.explanation,
      });
    }
  }

  const now = new Date().toISOString();
  const tierScores: Partial<Record<QuizTier, number>> = {};
  for (const tier of ALL_QUIZ_TIERS) {
    const tierResults = questionResults.filter((r) => r.tier === tier);
    if (tierResults.length === 0) continue;
    const avg = tierResults.reduce((sum, r) => sum + r.score, 0) / tierResults.length;
    tierScores[tier] = avg;
    await db.insert(quizResults).values({
      id: `qr_${randomUUID()}`,
      lessonId,
      tier,
      score: avg,
      date: now,
      idempotencyKey: idempotencyKey ?? null,
    });
  }

  const overallScore =
    questionResults.length > 0 ? questionResults.reduce((sum, r) => sum + r.score, 0) / questionResults.length : 0;

  await db
    .insert(masteryState)
    .values({ conceptNodeId: lessonId, knowledgeScore: overallScore, experienceScore: null, lastUpdated: now })
    .onConflictDoUpdate({
      target: masteryState.conceptNodeId,
      set: { knowledgeScore: overallScore, lastUpdated: now },
    });
  const [updatedMastery] = await db.select().from(masteryState).where(eq(masteryState.conceptNodeId, lessonId));

  const tierSummary = Object.entries(tierScores)
    .map(([tier, score]) => `${tier}: ${(score as number).toFixed(2)}`)
    .join(", ");
  await writeMastery(lessonId, "knowledge", overallScore, `Quiz session covering tier(s) — ${tierSummary}.`);

  const weakConceptNodes = overallScore < weakThreshold ? [lessonId] : [];
  if (weakConceptNodes.length > 0) {
    onProgress?.(
      `Weak concept node flagged: ${lessonId} (knowledge_score ${overallScore.toFixed(2)} < ${weakThreshold}).`
    );
  }

  const courseCompleted = (await checkAndMarkCourseCompletion(lessonId, db)) ?? undefined;
  if (courseCompleted) {
    onProgress?.(`Course ${courseCompleted} marked complete — every lesson now has quiz results across all three tiers.`);
  }

  const transferHighScoreAchieved = isTransferHighScoreAchieved(tierScores);
  if (transferHighScoreAchieved) {
    onProgress?.(`Transfer-tier score (${tierScores.transfer!.toFixed(2)}) crossed the high-score bar — a real milestone.`);
  }

  const [lessonRow] = await db.select().from(lessons).where(eq(lessons.id, lessonId));
  const [moduleRow] = lessonRow ? await db.select().from(modules).where(eq(modules.id, lessonRow.moduleId)) : [];
  if (moduleRow) {
    await recordActivity("quiz_completed", lessonId, moduleRow.courseId, { db });
  }

  return {
    lessonId,
    tierScores,
    overallScore,
    questionResults,
    weakConceptNodes,
    masteryState: updatedMastery!,
    transferHighScoreAchieved,
    ...(courseCompleted ? { courseCompleted } : {}),
  };
}
