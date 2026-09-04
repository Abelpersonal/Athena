import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getOrSynthesizeChunk, contentHashFor } from "../src/teachingEngine/audioCache.js";
import { getDb, resetDbCache } from "../src/db/client.js";
import { courses, modules, lessons } from "../src/db/schema.js";
import type { TeacherDb } from "../src/db/client.js";
import type { TTSProvider } from "../src/teachingEngine/tts/index.js";

const FIVE_LAYERS = {
  intuition: { text: "t", source_ids: [] },
  mechanics: { text: "t", source_ids: [] },
  formal: { text: "t", source_ids: [] },
  application: { text: "t", source_ids: [] },
  frontier: { text: "t", source_ids: [] },
};

async function seedLesson(db: TeacherDb, lessonId: string): Promise<void> {
  await db.insert(courses).values({ id: `crs_${lessonId}`, topic: "T", createdAt: "2026-01-01T00:00:00.000Z", volatilityTier: "medium", status: "complete" });
  await db.insert(modules).values({ id: `mod_${lessonId}`, courseId: `crs_${lessonId}`, title: "M", description: "d", order: 0, prerequisiteOf: [] });
  await db.insert(lessons).values({
    id: lessonId,
    moduleId: `mod_${lessonId}`,
    title: "L",
    description: "d",
    estimatedDuration: "5 min",
    layers: FIVE_LAYERS,
    sourceRefs: [],
    sourceStatus: "ok",
  });
}

function fakeProvider(): { provider: TTSProvider; callCount: () => number } {
  let calls = 0;
  const provider: TTSProvider = {
    name: "fake",
    async synthesize(text: string) {
      calls += 1;
      return { audio: Buffer.from(`audio-for:${text}`), contentType: "audio/mpeg" };
    },
  };
  return { provider, callCount: () => calls };
}

describe("getOrSynthesizeChunk", () => {
  let tmpDir: string;

  beforeEach(() => {
    resetDbCache();
    tmpDir = mkdtempSync(path.join(tmpdir(), "audio-cache-test-"));
  });

  afterEach(() => {
    resetDbCache();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("cache miss: calls the provider, writes a real file, and records a DB entry", async () => {
    const db = await getDb(":memory:");
    await seedLesson(db, "lsn_a");
    const { provider, callCount } = fakeProvider();

    const result = await getOrSynthesizeChunk(
      "lsn_a",
      { layer: "intuition", chunkIndex: 0, text: "Hello world." },
      { db, ttsProvider: provider, cacheDir: tmpDir }
    );

    expect(result.cacheHit).toBe(false);
    expect(result.audio.toString()).toBe("audio-for:Hello world.");
    expect(callCount()).toBe(1);

    const [lesson] = await db.select().from(lessons).where(eq(lessons.id, "lsn_a"));
    expect(lesson!.audioCacheRef).toHaveLength(1);
    const entry = lesson!.audioCacheRef![0]!;
    expect(entry.layer).toBe("intuition");
    expect(entry.chunkIndex).toBe(0);
    expect(entry.contentHash).toBe(contentHashFor("Hello world."));
    expect(existsSync(entry.filePath)).toBe(true);
  });

  it("cache hit: a second call for the SAME chunk text does not call the provider again", async () => {
    const db = await getDb(":memory:");
    await seedLesson(db, "lsn_b");
    const { provider, callCount } = fakeProvider();
    const chunk = { layer: "mechanics" as const, chunkIndex: 0, text: "Repeatable content." };

    const first = await getOrSynthesizeChunk("lsn_b", chunk, { db, ttsProvider: provider, cacheDir: tmpDir });
    expect(first.cacheHit).toBe(false);
    expect(callCount()).toBe(1);

    const second = await getOrSynthesizeChunk("lsn_b", chunk, { db, ttsProvider: provider, cacheDir: tmpDir });
    expect(second.cacheHit).toBe(true);
    expect(callCount()).toBe(1); // still 1 — no second synthesize() call
    expect(second.audio.toString()).toBe(first.audio.toString());
  });

  it("a content change (different text, same layer/chunkIndex) is treated as a cache MISS, not served stale", async () => {
    const db = await getDb(":memory:");
    await seedLesson(db, "lsn_c");
    const { provider, callCount } = fakeProvider();

    await getOrSynthesizeChunk(
      "lsn_c",
      { layer: "formal", chunkIndex: 0, text: "Original text." },
      { db, ttsProvider: provider, cacheDir: tmpDir }
    );
    expect(callCount()).toBe(1);

    const result = await getOrSynthesizeChunk(
      "lsn_c",
      { layer: "formal", chunkIndex: 0, text: "Updated text after a knowledge-update delta." },
      { db, ttsProvider: provider, cacheDir: tmpDir }
    );

    expect(result.cacheHit).toBe(false);
    expect(callCount()).toBe(2); // real re-synthesis, not served from the stale entry
    expect(result.audio.toString()).toContain("Updated text");

    const [lesson] = await db.select().from(lessons).where(eq(lessons.id, "lsn_c"));
    expect(lesson!.audioCacheRef).toHaveLength(1); // old entry replaced, not duplicated
    expect(lesson!.audioCacheRef![0]!.contentHash).toBe(contentHashFor("Updated text after a knowledge-update delta."));
  });

  it("different chunks (different layer or chunkIndex) accumulate independent cache entries", async () => {
    const db = await getDb(":memory:");
    await seedLesson(db, "lsn_d");
    const { provider } = fakeProvider();

    await getOrSynthesizeChunk("lsn_d", { layer: "intuition", chunkIndex: 0, text: "A" }, { db, ttsProvider: provider, cacheDir: tmpDir });
    await getOrSynthesizeChunk("lsn_d", { layer: "intuition", chunkIndex: 1, text: "B" }, { db, ttsProvider: provider, cacheDir: tmpDir });
    await getOrSynthesizeChunk("lsn_d", { layer: "mechanics", chunkIndex: 0, text: "C" }, { db, ttsProvider: provider, cacheDir: tmpDir });

    const [lesson] = await db.select().from(lessons).where(eq(lessons.id, "lsn_d"));
    expect(lesson!.audioCacheRef).toHaveLength(3);
  });
});
