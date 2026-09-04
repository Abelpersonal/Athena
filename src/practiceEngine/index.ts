import { randomUUID } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import { run as orchestratorRun } from "../orchestrator/index.js";
import type { ClassifyTopicTypeOutput } from "../orchestrator/templates/classifyTopicType.js";
import type { SelectPracticeFormatOutput } from "../orchestrator/templates/selectPracticeFormat.js";
import type { GenerateProjectBriefOutput } from "../orchestrator/templates/generateProjectBrief.js";
import type { GenerateSimulationScenarioOutput } from "../orchestrator/templates/generateSimulationScenario.js";
import type { GenerateDebatePromptOutput } from "../orchestrator/templates/generateDebatePrompt.js";
import type { DialogueTurnOutput, DialogueTurnHistoryEntry } from "../orchestrator/templates/dialogueTurn.js";
import type { CritiquePracticeAttemptOutput } from "../orchestrator/templates/critiquePracticeAttempt.js";
import type { GenerateReflectionPromptOutput } from "../orchestrator/templates/generateReflectionPrompt.js";
import { getDb, type TeacherDb } from "../db/client.js";
import { modules, lessons, practiceAttempts, masteryState } from "../db/schema.js";
import { writeMasteryUpdate as writeMasteryUpdateDefault } from "../memoryGraph/index.js";
import { recordActivityEvent as recordActivityEventDefault } from "../motivation/index.js";

export type OrchestratorRunFn = typeof orchestratorRun;
export type ProgressListener = (message: string) => void;
export type WriteMasteryUpdateFn = typeof writeMasteryUpdateDefault;
export type RecordActivityEventFn = typeof recordActivityEventDefault;
export type DialogueHistoryEntry = DialogueTurnHistoryEntry;

export class PracticeEngineError extends Error {}

export type TopicType = ClassifyTopicTypeOutput["topicType"];
export type PracticeFormat = "project" | "simulation" | "debate";
export type PracticeDifficulty = "guided" | "harder" | "novel_unguided";

export interface ProjectContent {
  task: string;
  datasetOrPrompt: string;
  deliverableExpectations: string;
}
export interface SimulationContent {
  scenario: string;
  personaName: string;
  personaRole: string;
  personaRules: string;
  openingLine: string;
}
export interface DebateContent {
  claim: string;
  userPosition: "for" | "against";
  openingArgument: string;
  opponentRules: string;
}

export interface PracticeSession {
  moduleId: string;
  moduleTitle: string;
  topicType: TopicType;
  topicTypeJustification: string;
  format: PracticeFormat;
  formatJustification: string;
  difficulty: PracticeDifficulty;
  attemptNumber: number;
  priorMistakes?: string;
  project?: ProjectContent;
  simulation?: SimulationContent;
  debate?: DebateContent;
}

/** Max attempts per module before the engine stops auto-generating progressively harder variants — the cap'th attempt (and every attempt after it) stays at "novel_unguided" rather than escalating indefinitely. Configurable; default 3 per the Phase 4 resolved default. */
export const DEFAULT_ESCALATION_CAP = Number(process.env.PRACTICE_ESCALATION_CAP ?? 3);

export interface PracticeEngineOptions {
  /** Injectable for tests. Default: the real orchestrator.run(). */
  orchestratorRun?: OrchestratorRunFn;
  /** Injectable for tests. Default: getDb() (real, migrated SQLite at data/teacher.db). */
  db?: TeacherDb;
  /** Injectable for tests. Default: the real memoryGraph.writeMasteryUpdate() (Phase 4). */
  writeMasteryUpdate?: WriteMasteryUpdateFn;
  /** Injectable for tests. Default: the real motivation.recordActivityEvent() (Phase 9). */
  recordActivityEvent?: RecordActivityEventFn;
  escalationCap?: number;
  onProgress?: ProgressListener;
}

/**
 * Pure escalation-cap logic, exported directly for unit testing. attempt 1
 * is "guided"; attempts 2..cap-1 are "harder"; attempt cap and every attempt
 * after it are pinned at "novel_unguided" — the engine never escalates past
 * that tier, per the Phase 4 resolved default (cap = 3).
 */
export function difficultyForAttemptNumber(attemptNumber: number, cap: number): PracticeDifficulty {
  if (attemptNumber >= cap) return "novel_unguided";
  if (attemptNumber <= 1) return "guided";
  return "harder";
}

async function loadModuleAndLessons(db: TeacherDb, moduleId: string) {
  const [mod] = await db.select().from(modules).where(eq(modules.id, moduleId));
  if (!mod) throw new PracticeEngineError(`No module found with id "${moduleId}".`);
  const moduleLessons = await db.select().from(lessons).where(eq(lessons.moduleId, moduleId));
  return { mod, moduleLessons };
}

async function nextAttemptNumber(db: TeacherDb, moduleId: string): Promise<number> {
  const rows = await db.select().from(practiceAttempts).where(eq(practiceAttempts.moduleId, moduleId));
  return rows.length + 1;
}

async function mostRecentFeedback(db: TeacherDb, moduleId: string): Promise<string | undefined> {
  const [latest] = await db
    .select()
    .from(practiceAttempts)
    .where(eq(practiceAttempts.moduleId, moduleId))
    .orderBy(desc(practiceAttempts.attemptNumber))
    .limit(1);
  return latest?.feedback;
}

/**
 * Practice Engine steps 0-1: classify topic_type (the deliberate deviation
 * from the PRD's "set by the Research Agent" — see README), select a
 * practice format, and generate that format's content — grounded in the
 * module's real lessons, and in the previous attempt's feedback once
 * difficulty has escalated past "guided" (step 6's "incorporating recurring
 * mistakes noted").
 */
export async function preparePracticeSession(
  moduleId: string,
  options: PracticeEngineOptions = {}
): Promise<PracticeSession> {
  const run = options.orchestratorRun ?? orchestratorRun;
  const db = options.db ?? (await getDb());
  const cap = options.escalationCap ?? DEFAULT_ESCALATION_CAP;
  const onProgress = options.onProgress;

  const { mod, moduleLessons } = await loadModuleAndLessons(db, moduleId);
  const lessonSummaries = moduleLessons.map((l) => ({ title: l.title, description: l.description }));

  const attemptNumber = await nextAttemptNumber(db, moduleId);
  const difficulty = difficultyForAttemptNumber(attemptNumber, cap);
  const priorMistakes = difficulty !== "guided" ? await mostRecentFeedback(db, moduleId) : undefined;

  onProgress?.(`[0] Classifying topic_type for module "${mod.title}"...`);
  const topicTypeResult = await run<ClassifyTopicTypeOutput>(
    "classify_topic_type",
    { moduleTitle: mod.title, moduleDescription: mod.description, lessonSummaries },
    "practice-engine"
  );
  const { topicType, justification: topicTypeJustification } = topicTypeResult.data;

  onProgress?.(`[1] Selecting practice format (topic_type: ${topicType}, difficulty: ${difficulty})...`);
  const formatResult = await run<SelectPracticeFormatOutput>(
    "select_practice_format",
    { moduleTitle: mod.title, moduleDescription: mod.description, topicType, difficulty },
    "practice-engine"
  );
  const { format, justification: formatJustification } = formatResult.data;

  const session: PracticeSession = {
    moduleId,
    moduleTitle: mod.title,
    topicType,
    topicTypeJustification,
    format,
    formatJustification,
    difficulty,
    attemptNumber,
    ...(priorMistakes ? { priorMistakes } : {}),
  };

  const contentContext = {
    moduleTitle: mod.title,
    moduleDescription: mod.description,
    lessonSummaries,
    difficulty,
    ...(priorMistakes ? { priorMistakes } : {}),
  };

  onProgress?.(`Generating ${format} content...`);
  if (format === "project") {
    const result = await run<GenerateProjectBriefOutput>("generate_project_brief", contentContext, "practice-engine");
    session.project = result.data;
  } else if (format === "simulation") {
    const result = await run<GenerateSimulationScenarioOutput>(
      "generate_simulation_scenario",
      contentContext,
      "practice-engine"
    );
    session.simulation = result.data;
  } else {
    const result = await run<GenerateDebatePromptOutput>("generate_debate_prompt", contentContext, "practice-engine");
    session.debate = result.data;
  }

  return session;
}

/**
 * Practice Engine step 2's per-turn call: respond in character, adapting to
 * the learner's actual input — shared by both "simulation" and "debate"
 * (the PRD's step 2 wording is generic, not format-specific; see
 * dialogue_turn's own doc comment). The CLI harness drives the actual
 * multi-turn loop via readline, calling this once per turn.
 */
export async function runDialogueTurn(
  session: PracticeSession,
  history: DialogueHistoryEntry[],
  userInput: string,
  options: PracticeEngineOptions = {}
): Promise<string> {
  const run = options.orchestratorRun ?? orchestratorRun;

  let personaInstructions: string;
  let situation: string;
  if (session.format === "simulation" && session.simulation) {
    const s = session.simulation;
    personaInstructions = `You are ${s.personaName}, ${s.personaRole}. ${s.personaRules}`;
    situation = s.scenario;
  } else if (session.format === "debate" && session.debate) {
    const d = session.debate;
    personaInstructions = `You are the learner's debate opponent, arguing the side opposite the learner's assigned position ("${d.userPosition}"). ${d.opponentRules}`;
    situation = `Contested claim: ${d.claim}`;
  } else {
    throw new PracticeEngineError(
      `runDialogueTurn called for module "${session.moduleId}" with format "${session.format}", which has no dialogue content.`
    );
  }

  const result = await run<DialogueTurnOutput>(
    "dialogue_turn",
    { personaInstructions, situation, history, userInput },
    "practice-engine"
  );
  return result.data.reply;
}

function practiceBriefText(session: PracticeSession): string {
  if (session.format === "project" && session.project) {
    const p = session.project;
    return `Task: ${p.task}\nStarting material: ${p.datasetOrPrompt}\nExpected deliverable: ${p.deliverableExpectations}`;
  }
  if (session.format === "simulation" && session.simulation) {
    const s = session.simulation;
    return `Scenario: ${s.scenario}\nCounterpart: ${s.personaName} (${s.personaRole})\nOpening line: ${s.openingLine}`;
  }
  if (session.format === "debate" && session.debate) {
    const d = session.debate;
    return `Claim: ${d.claim}\nLearner's assigned position: ${d.userPosition}\nOpponent's opening argument: ${d.openingArgument}`;
  }
  throw new PracticeEngineError(`Session for module "${session.moduleId}" has no content for format "${session.format}".`);
}

export interface CritiqueResult {
  critique: string;
  /** 0-1 continuous — drives MasteryState.experienceScore. */
  performanceScore: number;
}

/**
 * Practice Engine step 3: critique the learner's ACTUAL output for this
 * attempt (their project submission, or the full dialogue transcript) —
 * must reference what they specifically did, not a templated response.
 */
export async function critiquePracticeAttempt(
  session: PracticeSession,
  userOutput: string,
  options: PracticeEngineOptions = {}
): Promise<CritiqueResult> {
  const run = options.orchestratorRun ?? orchestratorRun;
  const result = await run<CritiquePracticeAttemptOutput>(
    "critique_practice_attempt",
    {
      moduleTitle: session.moduleTitle,
      format: session.format,
      practiceBrief: practiceBriefText(session),
      userOutput,
      attemptNumber: session.attemptNumber,
    },
    "practice-engine"
  );
  return result.data;
}

/** Practice Engine step 5: a reflection prompt tailored to this attempt's actual critique. */
export async function generateReflectionPromptText(
  session: PracticeSession,
  critique: string,
  options: PracticeEngineOptions = {}
): Promise<string> {
  const run = options.orchestratorRun ?? orchestratorRun;
  const result = await run<GenerateReflectionPromptOutput>(
    "generate_reflection_prompt",
    { moduleTitle: session.moduleTitle, format: session.format, critique },
    "practice-engine"
  );
  return result.data.reflectionPrompt;
}

export interface RecordPracticeAttemptResult {
  attemptId: string;
  attemptNumber: number;
  /** concept_node_id = lesson_id (see README) — a module-scoped practice attempt broadcasts its performanceScore to every lesson under that module, since MasteryState is currently keyed at lesson granularity. */
  updatedLessonIds: string[];
  willEscalateNextAttempt: boolean;
}

/**
 * Practice Engine step 4 + 7: persist the PracticeAttempt record (feedback
 * + reflectionNotes together, since both are known by the time this is
 * called) and update MasteryState.experienceScore — an upsert that targets
 * ONLY that column, so a practice run never touches knowledgeScore. Also
 * mirrors the update into the Memory Graph as a new dated fact, same as the
 * Quiz Engine does for knowledgeScore.
 */
export async function recordPracticeAttempt(
  session: PracticeSession,
  critique: string,
  reflectionNotes: string,
  performanceScore: number,
  options: PracticeEngineOptions = {}
): Promise<RecordPracticeAttemptResult> {
  const db = options.db ?? (await getDb());
  const writeMastery = options.writeMasteryUpdate ?? writeMasteryUpdateDefault;
  const recordActivity = options.recordActivityEvent ?? recordActivityEventDefault;
  const cap = options.escalationCap ?? DEFAULT_ESCALATION_CAP;
  const onProgress = options.onProgress;
  const now = new Date().toISOString();

  const attemptId = `pa_${randomUUID()}`;
  await db.insert(practiceAttempts).values({
    id: attemptId,
    moduleId: session.moduleId,
    type: session.format,
    attemptNumber: session.attemptNumber,
    feedback: critique,
    reflectionNotes,
    date: now,
  });

  const moduleLessons = await db.select().from(lessons).where(eq(lessons.moduleId, session.moduleId));
  const updatedLessonIds: string[] = [];
  for (const lesson of moduleLessons) {
    await db
      .insert(masteryState)
      .values({ conceptNodeId: lesson.id, knowledgeScore: null, experienceScore: performanceScore, lastUpdated: now })
      .onConflictDoUpdate({
        target: masteryState.conceptNodeId,
        set: { experienceScore: performanceScore, lastUpdated: now },
      });
    await writeMastery(
      lesson.id,
      "experience",
      performanceScore,
      `Practice attempt ${session.attemptNumber} (${session.format}) on module "${session.moduleTitle}".`
    );
    updatedLessonIds.push(lesson.id);
  }

  const [mod] = await db.select().from(modules).where(eq(modules.id, session.moduleId));
  if (mod) {
    await recordActivity("practice_completed", session.moduleId, mod.courseId, { db });
  }

  const willEscalateNextAttempt = session.attemptNumber < cap;
  onProgress?.(
    willEscalateNextAttempt
      ? `Attempt ${session.attemptNumber} recorded — the next attempt will be generated at a harder difficulty.`
      : `Attempt ${session.attemptNumber} recorded — escalation cap (${cap}) reached; further attempts stay at novel_unguided difficulty.`
  );

  return { attemptId, attemptNumber: session.attemptNumber, updatedLessonIds, willEscalateNextAttempt };
}
