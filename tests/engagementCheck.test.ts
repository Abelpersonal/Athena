import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { findInactivePathForNudge, runEngagementCheck } from "../src/engagementCheck/index.js";
import { getDb, resetDbCache } from "../src/db/client.js";
import { paths, pathDomains, pathTopics, courses, activityEvents, userProfile } from "../src/db/schema.js";
import type { TeacherDb } from "../src/db/client.js";

const NOW = new Date("2026-03-10T12:00:00.000Z");
function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

async function seedPathWithCourse(db: TeacherDb, pathId: string, courseId: string): Promise<void> {
  await db.insert(paths).values({ id: pathId, goalDescription: `Goal ${pathId}`, createdAt: "2026-01-01T00:00:00.000Z", status: "active" });
  await db.insert(pathDomains).values({ id: `dom_${pathId}`, pathId, name: "Domain", order: 0 });
  await db.insert(courses).values({ id: courseId, topic: "T", createdAt: "2026-01-01T00:00:00.000Z", volatilityTier: "medium", status: "complete" });
  await db.insert(pathTopics).values({
    id: `pt_${pathId}`,
    pathId,
    domainId: `dom_${pathId}`,
    topicName: "Topic",
    description: "d",
    order: 0,
    parallelGroup: "tier_0",
    status: "linked_existing",
    courseId,
  });
}

describe("findInactivePathForNudge", () => {
  beforeEach(() => resetDbCache());

  it("returns null with no active paths at all", async () => {
    const db = await getDb(":memory:");
    expect(await findInactivePathForNudge({ db, now: NOW })).toBeNull();
  });

  it("flags a path whose courses have gone quiet while another path stayed active", async () => {
    const db = await getDb(":memory:");
    await seedPathWithCourse(db, "path_quiet", "crs_quiet");
    await seedPathWithCourse(db, "path_active", "crs_active");
    await db.insert(activityEvents).values([
      { id: "ae_old", eventType: "lesson_viewed", entityId: "x", courseId: "crs_quiet", occurredAt: daysAgo(20) },
      { id: "ae_recent", eventType: "lesson_viewed", entityId: "y", courseId: "crs_active", occurredAt: daysAgo(1) },
    ]);

    const result = await findInactivePathForNudge({ db, now: NOW });
    expect(result?.pathId).toBe("path_quiet");
  });

  it("returns null when the whole app has simply been idle", async () => {
    const db = await getDb(":memory:");
    await seedPathWithCourse(db, "path_a", "crs_a");
    await db.insert(activityEvents).values({ id: "ae_old", eventType: "lesson_viewed", entityId: "x", courseId: "crs_a", occurredAt: daysAgo(20) });

    expect(await findInactivePathForNudge({ db, now: NOW })).toBeNull();
  });
});

describe("runEngagementCheck", () => {
  beforeEach(() => resetDbCache());

  it("sends a real push and records lastEngagementNudgeSentAt when a path is genuinely inactive and no nudge has been sent yet", async () => {
    const db = await getDb(":memory:");
    await seedPathWithCourse(db, "path_quiet", "crs_quiet");
    await seedPathWithCourse(db, "path_active", "crs_active");
    await db.insert(activityEvents).values([
      { id: "ae_old", eventType: "lesson_viewed", entityId: "x", courseId: "crs_quiet", occurredAt: daysAgo(20) },
      { id: "ae_recent", eventType: "lesson_viewed", entityId: "y", courseId: "crs_active", occurredAt: daysAgo(1) },
    ]);

    const pushCalls: Array<{ title: string; body: string }> = [];
    const result = await runEngagementCheck({
      db,
      now: NOW,
      sendPushToAllSubscriptions: async (payload) => {
        pushCalls.push(payload);
        return { sent: 1, removedStale: 0 };
      },
    });

    expect(result).toMatchObject({ nudgeSent: true, pathId: "path_quiet" });
    expect(pushCalls).toHaveLength(1);
    expect(pushCalls[0]!.body).toContain("path_quiet");

    const [profile] = await db.select().from(userProfile);
    expect(profile!.lastEngagementNudgeSentAt).toBe(NOW.toISOString());
  });

  it("does not send a second nudge on a repeated run against the SAME still-quiet stretch", async () => {
    const db = await getDb(":memory:");
    await seedPathWithCourse(db, "path_quiet", "crs_quiet");
    await seedPathWithCourse(db, "path_active", "crs_active");
    await db.insert(activityEvents).values([
      { id: "ae_old", eventType: "lesson_viewed", entityId: "x", courseId: "crs_quiet", occurredAt: daysAgo(20) },
      { id: "ae_recent", eventType: "lesson_viewed", entityId: "y", courseId: "crs_active", occurredAt: daysAgo(1) },
    ]);

    let pushCallCount = 0;
    const sendPushToAllSubscriptions = async () => {
      pushCallCount += 1;
      return { sent: 1, removedStale: 0 };
    };

    const first = await runEngagementCheck({ db, now: NOW, sendPushToAllSubscriptions });
    expect(first.nudgeSent).toBe(true);

    // A second scheduled-check run, a bit later, with NO new activity in between.
    const later = new Date(NOW.getTime() + 3_600_000);
    const second = await runEngagementCheck({ db, now: later, sendPushToAllSubscriptions });
    expect(second).toMatchObject({ nudgeSent: false, reason: "cadence_not_due" });
    expect(pushCallCount).toBe(1);
  });

  it("becomes eligible again after real fresh activity, then a new inactivity stretch", async () => {
    const db = await getDb(":memory:");
    await seedPathWithCourse(db, "path_quiet", "crs_quiet");
    await seedPathWithCourse(db, "path_active", "crs_active");
    await db.insert(activityEvents).values([
      { id: "ae_old", eventType: "lesson_viewed", entityId: "x", courseId: "crs_quiet", occurredAt: daysAgo(20) },
      { id: "ae_recent", eventType: "lesson_viewed", entityId: "y", courseId: "crs_active", occurredAt: daysAgo(1) },
    ]);
    let pushCallCount = 0;
    const sendPushToAllSubscriptions = async () => {
      pushCallCount += 1;
      return { sent: 1, removedStale: 0 };
    };

    await runEngagementCheck({ db, now: NOW, sendPushToAllSubscriptions });
    expect(pushCallCount).toBe(1);

    // The learner comes back (real fresh activity, AFTER the nudge)...
    await db.insert(activityEvents).values({ id: "ae_came_back", eventType: "lesson_viewed", entityId: "z", courseId: "crs_quiet", occurredAt: new Date(NOW.getTime() + 3_600_000).toISOString() });
    // ...then goes quiet again for a full new inactivity window.
    const muchLater = new Date(NOW.getTime() + 20 * 86_400_000);
    await db.insert(activityEvents).values({ id: "ae_recent2", eventType: "lesson_viewed", entityId: "y", courseId: "crs_active", occurredAt: new Date(muchLater.getTime() - 86_400_000).toISOString() });

    const second = await runEngagementCheck({ db, now: muchLater, sendPushToAllSubscriptions });
    expect(second.nudgeSent).toBe(true);
    expect(pushCallCount).toBe(2);
  });

  it("is a safe no-op when no path is currently inactive", async () => {
    const db = await getDb(":memory:");
    await seedPathWithCourse(db, "path_active", "crs_active");
    await db.insert(activityEvents).values({ id: "ae_recent", eventType: "lesson_viewed", entityId: "y", courseId: "crs_active", occurredAt: daysAgo(1) });

    const result = await runEngagementCheck({ db, now: NOW, sendPushToAllSubscriptions: async () => ({ sent: 0, removedStale: 0 }) });
    expect(result).toEqual({ nudgeSent: false, reason: "no_inactive_path" });
  });
});
