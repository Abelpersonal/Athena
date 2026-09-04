import { describe, it, expect, beforeEach } from "vitest";
import {
  buildKnowledgeUpdatePushPayload,
  buildEngagementNudgePushPayload,
  savePushSubscription,
  deletePushSubscription,
  sendPushToAllSubscriptions,
  type PushSubscriptionKeys,
} from "../src/push/index.js";
import { getDb, resetDbCache } from "../src/db/client.js";
import { pushSubscriptions } from "../src/db/schema.js";

describe("buildKnowledgeUpdatePushPayload", () => {
  it("builds a real notification grounded in the actual topic and delta, linking back into the app", () => {
    const payload = buildKnowledgeUpdatePushPayload({
      topicName: "Special Relativity",
      deltaSummary: "A core claim about time dilation was corrected.",
    });
    expect(payload.title).toContain("Special Relativity");
    expect(payload.body).toBe("A core claim about time dilation was corrected.");
    expect(payload.url).toBe("/");
  });
});

describe("buildEngagementNudgePushPayload", () => {
  it("references the real path goal, with no urgency/guilt/streak-loss language", () => {
    const payload = buildEngagementNudgePushPayload("become financially independent");
    expect(payload.body).toContain("become financially independent");
    const lowered = `${payload.title} ${payload.body}`.toLowerCase();
    for (const bannedPhrase of ["don't lose", "you're behind", "hurry", "streak", "!"]) {
      expect(lowered).not.toContain(bannedPhrase);
    }
  });
});

const sub1: PushSubscriptionKeys = { endpoint: "https://push.example.com/sub1", keys: { p256dh: "p1", auth: "a1" } };
const sub2: PushSubscriptionKeys = { endpoint: "https://push.example.com/sub2", keys: { p256dh: "p2", auth: "a2" } };

describe("savePushSubscription / deletePushSubscription", () => {
  beforeEach(() => resetDbCache());

  it("creates a new row for a new endpoint", async () => {
    const db = await getDb(":memory:");
    await savePushSubscription(sub1, { db });
    const rows = await db.select().from(pushSubscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ endpoint: sub1.endpoint, p256dh: "p1", auth: "a1" });
  });

  it("re-subscribing the SAME endpoint updates keys in place rather than duplicating the row", async () => {
    const db = await getDb(":memory:");
    await savePushSubscription(sub1, { db });
    await savePushSubscription({ endpoint: sub1.endpoint, keys: { p256dh: "new-p", auth: "new-a" } }, { db });

    const rows = await db.select().from(pushSubscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ p256dh: "new-p", auth: "new-a" });
  });

  it("delete removes exactly the matching endpoint", async () => {
    const db = await getDb(":memory:");
    await savePushSubscription(sub1, { db });
    await savePushSubscription(sub2, { db });
    await deletePushSubscription(sub1.endpoint, { db });

    const rows = await db.select().from(pushSubscriptions);
    expect(rows.map((r) => r.endpoint)).toEqual([sub2.endpoint]);
  });
});

describe("sendPushToAllSubscriptions", () => {
  beforeEach(() => resetDbCache());

  it("sends to every subscribed device", async () => {
    const db = await getDb(":memory:");
    await savePushSubscription(sub1, { db });
    await savePushSubscription(sub2, { db });

    const sent: string[] = [];
    const result = await sendPushToAllSubscriptions(
      { title: "t", body: "b", url: "/" },
      { db, sendNotification: async (sub) => void sent.push(sub.endpoint) }
    );

    expect(result).toEqual({ sent: 2, removedStale: 0 });
    expect(sent.sort()).toEqual([sub1.endpoint, sub2.endpoint].sort());
  });

  it("a 410 Gone response deletes the stale subscription and doesn't block the rest", async () => {
    const db = await getDb(":memory:");
    await savePushSubscription(sub1, { db });
    await savePushSubscription(sub2, { db });

    const result = await sendPushToAllSubscriptions(
      { title: "t", body: "b", url: "/" },
      {
        db,
        sendNotification: async (sub) => {
          if (sub.endpoint === sub1.endpoint) {
            const err = new Error("Gone") as Error & { statusCode: number };
            err.statusCode = 410;
            throw err;
          }
        },
      }
    );

    expect(result).toEqual({ sent: 1, removedStale: 1 });
    const remaining = await db.select().from(pushSubscriptions);
    expect(remaining.map((r) => r.endpoint)).toEqual([sub2.endpoint]);
  });

  it("a non-410/404 failure on one subscription is skipped, not thrown, and doesn't block the rest", async () => {
    const db = await getDb(":memory:");
    await savePushSubscription(sub1, { db });
    await savePushSubscription(sub2, { db });

    const result = await sendPushToAllSubscriptions(
      { title: "t", body: "b", url: "/" },
      {
        db,
        sendNotification: async (sub) => {
          if (sub.endpoint === sub1.endpoint) throw new Error("Transient network error");
        },
      }
    );

    expect(result).toEqual({ sent: 1, removedStale: 0 });
    const remaining = await db.select().from(pushSubscriptions);
    expect(remaining).toHaveLength(2); // the transiently-failed one is NOT deleted, unlike a 410/404
  });

  it("with no subscriptions at all, sends nothing and doesn't error", async () => {
    const db = await getDb(":memory:");
    const result = await sendPushToAllSubscriptions({ title: "t", body: "b", url: "/" }, { db, sendNotification: async () => {} });
    expect(result).toEqual({ sent: 0, removedStale: 0 });
  });
});
