import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { run as orchestratorRun } from "../orchestrator/index.js";
import type { QuizQuestionsOutput } from "../orchestrator/templates/generateRecallQuestions.js";
import type { ScoreFreeTextAnswerOutput } from "../orchestrator/templates/scoreFreeTextAnswer.js";
import { getDb, type TeacherDb } from "../db/client.js";
import { lessons, quizResults, masteryState } from "../db/schema.js";
import { writeMasteryUpdate as writeMasteryUpdateDefault } from "../memoryGraph/index.js";

export type OrchestratorRunFn = typeof orchestratorRun;
export type ProgressListener = (message: string) => void;
export type WriteMasteryUpdateFn = typeof writeMasteryUpdateDefault;

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
}

/** 0-1 continuous score scale for both knowledgeScore and experienceScore (resolved default, see README). */
export const DEFAULT_QUESTIONS_PER_TIER = Number(process.env.QUIZ_QUESTIONS_PER_TIER ?? 2);
/** Below this knowledge_score, a concept node is surfaced as a weak-concept candidate (not load-bearing yet — see README). */
export const DEFAULT_WEAK_CONCEPT_THRESHOLD = Number(process.env.QUIZ_WEAK_CONCEPT_THRESHOLD ?? 0.6);

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
  questionsPerTier?: number;
  weakConceptThreshold?: number;
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
 * Quiz Engine steps 3-5: score every answer — objective questions in code,
 * free-text questions via a semantic (not keyword-match) Orchestrator call —
 * write one QuizResult row per tier tested, update
 * MasteryState.knowledgeScore (an upsert that targets ONLY that column, so a
 * quiz run never touches experienceScore), mirror the update into the
 * Memory Graph as a new dated fact, and surface any weak concept node.
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
  const weakThreshold = options.weakConceptThreshold ?? DEFAULT_WEAK_CONCEPT_THRESHOLD;
  const onProgress = options.onProgress;

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
    await db.insert(quizResults).values({ id: `qr_${randomUUID()}`, lessonId, tier, score: avg, date: now });
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

  return { lessonId, tierScores, overallScore, questionResults, weakConceptNodes, masteryState: updatedMastery! };
}
