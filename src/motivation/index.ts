import { randomUUID } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import { run as orchestratorRun } from "../orchestrator/index.js";
import type { ConnectActivityToGoalOutput } from "../orchestrator/templates/connectActivityToGoal.js";
import { getDb, type TeacherDb } from "../db/client.js";
import { activityEvents, userProfile, courses, USER_PROFILE_SINGLETON_ID, type ActivityEventType } from "../db/schema.js";
import { shouldShowGoalConnection } from "./pure.js";

export type OrchestratorRunFn = typeof orchestratorRun;

export interface RecordActivityEventOptions {
  db?: TeacherDb;
}

/**
 * Phase 9's real-activity instrumentation: one additive insert per genuine user action (a lesson
 * viewed, a quiz completed, a practice attempt recorded, a lesson question asked) — see the
 * README's "Where ActivityEvents are written from" for the exact call sites. Deliberately called
 * from inside the owning engine function (scoreAndRecordQuiz, recordPracticeAttempt,
 * answerLessonQuestion) rather than the thin API route wrapping it, mirroring exactly where every
 * other real-action side effect (writeMasteryUpdate) already lives in this codebase — the routes
 * stay thin, the engine owns its own side effects.
 *
 * Unlike the Memory Graph's best-effort writes, this does NOT degrade on failure — it's a plain
 * DB insert against the same SQLite database every other write in this codebase already depends
 * on, not an optional external service, so a failure here should surface exactly like any other
 * DB write failure, not be silently swallowed and leave streak/re-entry/boredom-proofing quietly
 * wrong with no operator-visible signal.
 */
export async function recordActivityEvent(
  eventType: ActivityEventType,
  entityId: string,
  courseId: string,
  options: RecordActivityEventOptions = {}
): Promise<void> {
  const db = options.db ?? (await getDb());
  await db.insert(activityEvents).values({
    id: `ae_${randomUUID()}`,
    eventType,
    entityId,
    courseId,
    occurredAt: new Date().toISOString(),
  });
}
export type RecordActivityEventFn = typeof recordActivityEvent;

export interface UserProfileData {
  statedGoals: string[];
  lastGoalConnectionShownAt: string | null;
}

/** Deliverable 1's read: null means the singleton row doesn't exist yet — the Dashboard's first-run redirect gate. */
export async function getUserProfile(options: { db?: TeacherDb } = {}): Promise<UserProfileData | null> {
  const db = options.db ?? (await getDb());
  const [row] = await db.select().from(userProfile).where(eq(userProfile.id, USER_PROFILE_SINGLETON_ID));
  if (!row) return null;
  return { statedGoals: row.statedGoals, lastGoalConnectionShownAt: row.lastGoalConnectionShownAt };
}

/**
 * Deliverable 1's write — creates the singleton row on first save (onboarding, including an
 * explicit "skip," which saves an empty array rather than leaving no row at all — a row existing
 * at all is what stops the Dashboard's first-run redirect from firing again), upserts on every
 * later edit (the Dashboard's "edit what you're working toward" link reuses this same onboarding
 * screen). `lastGoalConnectionShownAt` and `createdAt` are deliberately left out of the update
 * set below, so editing goals later never resets either.
 */
export async function saveUserProfile(statedGoals: string[], options: { db?: TeacherDb } = {}): Promise<void> {
  const db = options.db ?? (await getDb());
  const now = new Date().toISOString();
  await db
    .insert(userProfile)
    .values({ id: USER_PROFILE_SINGLETON_ID, statedGoals, lastGoalConnectionShownAt: null, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: userProfile.id, set: { statedGoals, updatedAt: now } });
}

export interface GoalConnectionMessageOptions {
  db?: TeacherDb;
  orchestratorRun?: OrchestratorRunFn;
  now?: Date;
}
export interface GoalConnectionMessage {
  message: string;
  courseTopic: string;
}

/**
 * Deliverable 2's "ties back to stated goals" piece. Returns null whenever there is genuinely
 * nothing to show — no UserProfile yet, no stated goals, no real ActivityEvent yet, or the
 * cadence window (shouldShowGoalConnection, src/motivation/pure.ts) hasn't elapsed — the
 * Dashboard omits the section entirely in every one of those cases, never rendering a
 * placeholder. Marking `lastGoalConnectionShownAt` happens INLINE in this same call, right after
 * a real message is generated — a deliberate v1 simplification: this runs from a Server Component
 * page read (see README, "The goal-connection cadence write"), and the small risk of an extra
 * write from a duplicate render is harmless here since the cadence check itself already tolerates
 * being triggered more than exactly once per calendar day.
 *
 * The Orchestrator call is wrapped and degrades to null on failure (logged, not silent) rather
 * than propagating — a Server Component page read (the Dashboard) must never go down because of
 * an LLM hiccup, the same "an enrichment step, not a precondition" policy Phase 8's mind map
 * generation and every Memory Graph write already follow.
 */
export async function getGoalConnectionMessage(options: GoalConnectionMessageOptions = {}): Promise<GoalConnectionMessage | null> {
  const db = options.db ?? (await getDb());
  const run = options.orchestratorRun ?? orchestratorRun;
  const now = options.now ?? new Date();

  const profile = await getUserProfile({ db });
  if (!profile || profile.statedGoals.length === 0) return null;
  if (!shouldShowGoalConnection(profile.lastGoalConnectionShownAt, now)) return null;

  const [recentEvent] = await db.select().from(activityEvents).orderBy(desc(activityEvents.occurredAt)).limit(1);
  if (!recentEvent) return null;

  const [course] = await db.select().from(courses).where(eq(courses.id, recentEvent.courseId));
  if (!course) return null;

  let message: string;
  try {
    const result = await run<ConnectActivityToGoalOutput>(
      "connect_activity_to_goal",
      { courseTopic: course.topic, statedGoals: profile.statedGoals },
      "motivation-layer"
    );
    message = result.data.message;
  } catch (error) {
    console.error(`[motivation] Failed to generate a goal-connection message: ${(error as Error).message}`);
    return null;
  }

  await db.update(userProfile).set({ lastGoalConnectionShownAt: now.toISOString() }).where(eq(userProfile.id, USER_PROFILE_SINGLETON_ID));

  return { message, courseTopic: course.topic };
}

export * from "./pure.js";
