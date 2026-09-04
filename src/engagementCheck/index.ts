import { eq } from "drizzle-orm";
import { getDb, type TeacherDb } from "../db/client.js";
import { paths, pathTopics, activityEvents, userProfile, USER_PROFILE_SINGLETON_ID } from "../db/schema.js";
import { isPathInactive, isEngagementNudgeDue } from "../motivation/pure.js";
import { buildEngagementNudgePushPayload, sendPushToAllSubscriptions as sendPushToAllSubscriptionsDefault } from "../push/index.js";

export type SendPushToAllSubscriptionsFn = typeof sendPushToAllSubscriptionsDefault;
export type ProgressListener = (message: string) => void;

/**
 * Phase 10, Deliverable 5: the engagement nudge's own scheduled-job entrypoint
 * (`npm run engagement-check`), mirroring `src/knowledgeUpdate/cli.ts`'s exact "run manually or
 * via external scheduler, not a persistent daemon" shape (PRD's "no heavy job-queue infra"
 * guidance) — deliberately its own script, not folded into `knowledge-update`, since the trigger
 * condition and cadence are unrelated to topic staleness.
 *
 * Reuses Phase 9's OWN inactivity signal (`isPathInactive`) verbatim, scoped per active Path, and
 * Phase 9's `ActivityEvent` table as the sole data source — not a second inactivity detector.
 * Picking a path to name in the push copy is real: the FIRST active path `isPathInactive` flags,
 * in `paths` insertion order — good enough for a single-user app where "gone quiet" rarely means
 * more than one path at once, and simpler than ranking multiple flagged paths against each other.
 */

export interface FindInactivePathForNudgeOptions {
  db?: TeacherDb;
  now?: Date;
}

export interface InactivePathForNudge {
  pathId: string;
  goalDescription: string;
  /** The flagged path's OWN most recent ActivityEvent, if it's ever had one — what isEngagementNudgeDue's cadence gate compares against, never the global/app-wide most recent event (see that function's doc comment for why). */
  mostRecentEventTimestamp: string | null;
}

/**
 * The lightweight, LLM-free version of db/queries.ts's getBoredomProofingSuggestions — this only
 * needs WHICH path (if any) is flagged, not the diversity-biased in-app copy variant, so it
 * doesn't make the `infer_course_domain` LLM call that function's Dashboard-facing sibling does
 * (keeping this script's own "none of this phase's new work calls the LLM directly" property).
 */
export async function findInactivePathForNudge(
  options: FindInactivePathForNudgeOptions = {}
): Promise<InactivePathForNudge | null> {
  const db = options.db ?? (await getDb());
  const now = options.now ?? new Date();

  const activePaths = await db.select().from(paths).where(eq(paths.status, "active"));
  if (activePaths.length === 0) return null;

  const allEvents = await db.select({ courseId: activityEvents.courseId, occurredAt: activityEvents.occurredAt }).from(activityEvents);

  for (const p of activePaths) {
    const topics = await db.select().from(pathTopics).where(eq(pathTopics.pathId, p.id));
    const pathCourseIds = new Set(topics.map((t) => t.courseId).filter((id): id is string => id !== null));
    if (pathCourseIds.size === 0) continue;

    const pathTimestamps = allEvents.filter((e) => pathCourseIds.has(e.courseId)).map((e) => e.occurredAt);
    const otherTimestamps = allEvents.filter((e) => !pathCourseIds.has(e.courseId)).map((e) => e.occurredAt);

    if (isPathInactive(pathTimestamps, otherTimestamps, now)) {
      const mostRecentEventTimestamp = pathTimestamps.length > 0 ? [...pathTimestamps].sort().at(-1)! : null;
      return { pathId: p.id, goalDescription: p.goalDescription, mostRecentEventTimestamp };
    }
  }
  return null;
}

export interface RunEngagementCheckOptions {
  db?: TeacherDb;
  now?: Date;
  sendPushToAllSubscriptions?: SendPushToAllSubscriptionsFn;
  onProgress?: ProgressListener;
}

export interface RunEngagementCheckResult {
  nudgeSent: boolean;
  reason: string;
  pathId?: string;
}

/**
 * The full scheduled-check run. Two independent gates both have to pass: (1) a real path is
 * currently flagged inactive (`findInactivePathForNudge`), and (2) `isEngagementNudgeDue` — the
 * "at most one per inactivity episode" cadence, comparing THAT path's own most recent
 * ActivityEvent against `userProfile.lastEngagementNudgeSentAt` (not a global/app-wide timestamp
 * — see `isEngagementNudgeDue`'s own doc comment for why that would be wrong). A repeated run
 * against the same still-quiet stretch is a safe no-op, same idempotency shape as
 * `runKnowledgeUpdateAgent`.
 */
export async function runEngagementCheck(options: RunEngagementCheckOptions = {}): Promise<RunEngagementCheckResult> {
  const db = options.db ?? (await getDb());
  const now = options.now ?? new Date();
  const sendPush = options.sendPushToAllSubscriptions ?? sendPushToAllSubscriptionsDefault;
  const onProgress = options.onProgress;

  const inactivePath = await findInactivePathForNudge({ db, now });
  if (!inactivePath) {
    onProgress?.("No active path has gone quiet — nothing to do.");
    return { nudgeSent: false, reason: "no_inactive_path" };
  }

  const [profile] = await db.select().from(userProfile).where(eq(userProfile.id, USER_PROFILE_SINGLETON_ID));
  const lastNudgeSentAt = profile?.lastEngagementNudgeSentAt ?? null;

  if (!isEngagementNudgeDue(inactivePath.mostRecentEventTimestamp, lastNudgeSentAt)) {
    onProgress?.(`"${inactivePath.goalDescription}" is quiet, but a nudge already covers this stretch — no-op.`);
    return { nudgeSent: false, reason: "cadence_not_due", pathId: inactivePath.pathId };
  }

  const payload = buildEngagementNudgePushPayload(inactivePath.goalDescription);
  const pushResult = await sendPush(payload, { db });
  onProgress?.(`Engagement nudge sent to ${pushResult.sent} device(s) for "${inactivePath.goalDescription}".`);

  const nowIso = now.toISOString();
  if (profile) {
    await db.update(userProfile).set({ lastEngagementNudgeSentAt: nowIso }).where(eq(userProfile.id, USER_PROFILE_SINGLETON_ID));
  } else {
    // No UserProfile row yet (onboarding never ran) — still record the nudge so the cadence gate
    // holds even before a real profile exists, rather than silently failing to persist it.
    await db.insert(userProfile).values({
      id: USER_PROFILE_SINGLETON_ID,
      statedGoals: [],
      lastGoalConnectionShownAt: null,
      lastEngagementNudgeSentAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }

  return { nudgeSent: true, reason: "sent", pathId: inactivePath.pathId };
}
