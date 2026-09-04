import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  recordActivityEvent,
  getUserProfile,
  saveUserProfile,
  getGoalConnectionMessage,
} from "../src/motivation/index.js";
import { getDb, resetDbCache } from "../src/db/client.js";
import { courses, activityEvents, userProfile } from "../src/db/schema.js";
import type { TeacherDb } from "../src/db/client.js";
import type { OrchestratorResult, RunOptions } from "../src/orchestrator/index.js";

type MockRun = (
  taskType: string,
  context: Record<string, unknown>,
  callingModule: string,
  options?: RunOptions
) => Promise<OrchestratorResult<unknown>>;

async function seedCourse(db: TeacherDb, id = "crs_test", topic = "Test Topic"): Promise<void> {
  await db.insert(courses).values({ id, topic, createdAt: new Date().toISOString(), volatilityTier: "medium", status: "complete" });
}

describe("recordActivityEvent", () => {
  beforeEach(() => resetDbCache());

  it("inserts a real row with the given eventType/entityId/courseId and a real occurredAt", async () => {
    const db = await getDb(":memory:");
    await seedCourse(db);
    await recordActivityEvent("lesson_viewed", "lsn_1", "crs_test", { db });

    const rows = await db.select().from(activityEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ eventType: "lesson_viewed", entityId: "lsn_1", courseId: "crs_test" });
    expect(rows[0]!.occurredAt).toBeTruthy();
  });
});

describe("getUserProfile / saveUserProfile", () => {
  beforeEach(() => resetDbCache());

  it("returns null when no profile has ever been saved", async () => {
    const db = await getDb(":memory:");
    expect(await getUserProfile({ db })).toBeNull();
  });

  it("creates the singleton row on first save, including an explicit skip (empty array)", async () => {
    const db = await getDb(":memory:");
    await saveUserProfile([], { db });
    const profile = await getUserProfile({ db });
    expect(profile).toEqual({ statedGoals: [], lastGoalConnectionShownAt: null });
  });

  it("upserts on a later edit without duplicating the row or resetting lastGoalConnectionShownAt", async () => {
    const db = await getDb(":memory:");
    await saveUserProfile(["Get better at cooking"], { db });
    await db.update(userProfile).set({ lastGoalConnectionShownAt: "2026-01-01T00:00:00.000Z" }).where(eq(userProfile.id, "singleton"));

    await saveUserProfile(["Get better at cooking", "Learn to play piano"], { db });

    const rows = await db.select().from(userProfile);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.statedGoals).toEqual(["Get better at cooking", "Learn to play piano"]);
    expect(rows[0]!.lastGoalConnectionShownAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("getGoalConnectionMessage", () => {
  beforeEach(() => resetDbCache());

  function respond(data: unknown): OrchestratorResult<unknown> {
    return { taskType: "connect_activity_to_goal", promptVersion: "test", data, attempts: 1, raw: JSON.stringify(data) };
  }

  it("returns null when there's no UserProfile yet", async () => {
    const db = await getDb(":memory:");
    expect(await getGoalConnectionMessage({ db })).toBeNull();
  });

  it("returns null when the profile exists but has no stated goals", async () => {
    const db = await getDb(":memory:");
    await saveUserProfile([], { db });
    expect(await getGoalConnectionMessage({ db })).toBeNull();
  });

  it("returns null when there's no ActivityEvent yet, even with real stated goals", async () => {
    const db = await getDb(":memory:");
    await saveUserProfile(["Become a better writer"], { db });
    expect(await getGoalConnectionMessage({ db })).toBeNull();
  });

  it("returns null when the cadence window hasn't elapsed since it was last shown", async () => {
    const db = await getDb(":memory:");
    await seedCourse(db);
    await recordActivityEvent("lesson_viewed", "lsn_1", "crs_test", { db });
    await saveUserProfile(["Become a better writer"], { db });
    const now = new Date();
    await db.update(userProfile).set({ lastGoalConnectionShownAt: new Date(now.getTime() - 3_600_000).toISOString() }).where(eq(userProfile.id, "singleton"));

    const mock: MockRun = async () => {
      throw new Error("should not be called — cadence window hasn't elapsed");
    };
    expect(await getGoalConnectionMessage({ db, orchestratorRun: mock as never, now })).toBeNull();
  });

  it("generates a real message grounded in the most recent activity's course and the real stated goals, then marks lastGoalConnectionShownAt", async () => {
    const db = await getDb(":memory:");
    await seedCourse(db, "crs_test", "Special Relativity");
    await recordActivityEvent("lesson_viewed", "lsn_1", "crs_test", { db });
    await saveUserProfile(["Understand physics deeply"], { db });

    let capturedContext: Record<string, unknown> | undefined;
    const mock: MockRun = async (taskType, context) => {
      capturedContext = context;
      return respond({ message: "You just studied Special Relativity — real progress toward understanding physics deeply." });
    };

    const now = new Date();
    const result = await getGoalConnectionMessage({ db, orchestratorRun: mock as never, now });
    expect(result).toEqual({ message: "You just studied Special Relativity — real progress toward understanding physics deeply.", courseTopic: "Special Relativity" });
    expect(capturedContext).toMatchObject({ courseTopic: "Special Relativity", statedGoals: ["Understand physics deeply"] });

    const [profile] = await db.select().from(userProfile);
    expect(profile!.lastGoalConnectionShownAt).toBe(now.toISOString());
  });

  it("degrades to null (not a thrown error) when the Orchestrator call fails, and does not mark lastGoalConnectionShownAt", async () => {
    const db = await getDb(":memory:");
    await seedCourse(db, "crs_test", "Special Relativity");
    await recordActivityEvent("lesson_viewed", "lsn_1", "crs_test", { db });
    await saveUserProfile(["Understand physics deeply"], { db });

    const mock: MockRun = async () => {
      throw new Error("simulated API failure");
    };

    const result = await getGoalConnectionMessage({ db, orchestratorRun: mock as never });
    expect(result).toBeNull();

    const [profile] = await db.select().from(userProfile);
    expect(profile!.lastGoalConnectionShownAt).toBeNull();
  });
});
