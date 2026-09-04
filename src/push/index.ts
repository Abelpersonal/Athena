import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import webpush from "web-push";
import { getDb, type TeacherDb } from "../db/client.js";
import { pushSubscriptions } from "../db/schema.js";

export class PushError extends Error {}

/**
 * Phase 10, Deliverable 5: real Web Push (VAPID, no third-party push-service billing beyond the
 * browser vendors' own infra — see README). Exactly two real trigger points call into this module
 * — a Knowledge Update Agent major-severity delta (src/knowledgeUpdate/index.ts) and the
 * engagement-check script's inactivity nudge (src/engagementCheck/index.ts) — per the kickoff's
 * own scope boundary #2 ("nothing else gets a push notification").
 */

export interface PushSubscriptionKeys {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
  /** Where a click on the notification navigates — always a real, existing in-app route. */
  url: string;
}

/**
 * Knowledge Update Agent (Phase 6/10): a major-severity delta just detected for a real course.
 * Pure — no I/O — so the exact copy is directly unit testable without a real push send.
 */
export function buildKnowledgeUpdatePushPayload(event: { topicName: string; deltaSummary: string }): PushPayload {
  return {
    title: `${event.topicName}: something changed`,
    body: event.deltaSummary,
    url: "/",
  };
}

/**
 * The engagement nudge (Phase 9's boredom-proofing signal, now a real push — Phase 10 Deliverable
 * 5). Tone-checked against §5.12b/§6.1: no urgency, no guilt, no streak-loss framing — a single,
 * low-pressure observation, matching the exact copy style Phase 9's in-app boredom-proofing
 * message already uses.
 */
export function buildEngagementNudgePushPayload(pathGoalDescription: string): PushPayload {
  return {
    title: "Whenever you're ready",
    body: `"${pathGoalDescription}" has been quiet for a while — no rush, it'll be right where you left it.`,
    url: "/",
  };
}

export interface SavePushSubscriptionOptions {
  db?: TeacherDb;
}

/** Idempotent on `endpoint` (the Push API's own unique key for a subscription) — re-subscribing the same browser/device just refreshes its keys, never duplicates the row. */
export async function savePushSubscription(sub: PushSubscriptionKeys, options: SavePushSubscriptionOptions = {}): Promise<void> {
  const db = options.db ?? (await getDb());
  const [existing] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint));
  if (existing) {
    await db
      .update(pushSubscriptions)
      .set({ p256dh: sub.keys.p256dh, auth: sub.keys.auth })
      .where(eq(pushSubscriptions.endpoint, sub.endpoint));
    return;
  }
  await db.insert(pushSubscriptions).values({
    id: `push_${randomUUID()}`,
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    createdAt: new Date().toISOString(),
  });
}

export async function deletePushSubscription(endpoint: string, options: SavePushSubscriptionOptions = {}): Promise<void> {
  const db = options.db ?? (await getDb());
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export type SendNotificationFn = (sub: PushSubscriptionKeys, payloadJson: string) => Promise<void>;

async function realSendNotification(sub: PushSubscriptionKeys, payloadJson: string): Promise<void> {
  await webpush.sendNotification(sub, payloadJson);
}

export interface SendPushOptions {
  db?: TeacherDb;
  /** Injectable for tests, matching this codebase's usual external-service DI convention (orchestratorRun, writeMasteryUpdate, ...). Default: the real web-push send, which requires real VAPID env vars. */
  sendNotification?: SendNotificationFn;
}
export interface SendPushResult {
  sent: number;
  /** Subscriptions the push service reported as gone (410/404) — deleted, never retried. */
  removedStale: number;
}

function configureVapid(): void {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new PushError(
      "VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT must all be set to send a real push notification — see .env.example."
    );
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

/**
 * Sends one payload to EVERY subscribed device (a single-user app can have several — see the
 * `pushSubscriptions` schema doc comment). A subscription the push service reports as expired
 * (410 Gone) or unknown (404) is deleted outright — never retried, since a stale endpoint will
 * only ever fail again. Any other per-subscription failure is logged and skipped, not thrown —
 * one dead subscription must never block delivery to the rest. Real VAPID keys are only required
 * (and only checked) on the REAL send path — an injected `sendNotification` (tests) needs none.
 */
export async function sendPushToAllSubscriptions(payload: PushPayload, options: SendPushOptions = {}): Promise<SendPushResult> {
  const db = options.db ?? (await getDb());
  const send = options.sendNotification ?? realSendNotification;
  if (!options.sendNotification) configureVapid();

  const subs = await db.select().from(pushSubscriptions);
  let sent = 0;
  let removedStale = 0;

  for (const sub of subs) {
    try {
      await send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload));
      sent += 1;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 410 || statusCode === 404) {
        await deletePushSubscription(sub.endpoint, { db });
        removedStale += 1;
        continue;
      }
      console.error(`[push] Failed to send to a subscription (endpoint ending ...${sub.endpoint.slice(-12)}): ${(error as Error).message}`);
    }
  }

  return { sent, removedStale };
}
