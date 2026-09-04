import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb, type TeacherDb } from "../db/client.js";
import { lessons, type AudioCacheEntry } from "../db/schema.js";
import type { LessonLayerKey } from "./chunkLessonAudio.js";
import type { TTSProvider } from "./tts/index.js";

export type { AudioCacheEntry } from "../db/schema.js";

/** Local disk under data/, matching this project's existing local-first storage pattern (source text, the SQLite file itself) — not R2/cloud storage, per the PRD's pick for a personal, single-user, local-first app. */
const CACHE_ROOT = process.env.AUDIO_CACHE_DIR ?? path.join(process.cwd(), "data", "audio-cache");

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/opus": "opus",
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/wav": "wav",
  "audio/pcm": "pcm",
};

/** The actual cache key — a hash of the chunk's OWN text, not lessonId+chunkIndex alone, so a later content change (e.g. Phase 6 regenerating a layer) naturally invalidates just that chunk's audio with zero explicit coupling between the two phases. */
export function contentHashFor(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function cacheFilePath(cacheRoot: string, lessonId: string, contentHash: string, extension: string): string {
  return path.join(cacheRoot, lessonId, `${contentHash}.${extension}`);
}

async function readCachedFile(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function findCacheEntry(
  db: TeacherDb,
  lessonId: string,
  layer: LessonLayerKey,
  chunkIndex: number
): Promise<AudioCacheEntry | null> {
  const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId));
  const existing = lesson?.audioCacheRef ?? [];
  return existing.find((e) => e.layer === layer && e.chunkIndex === chunkIndex) ?? null;
}

async function recordCacheEntry(db: TeacherDb, lessonId: string, entry: AudioCacheEntry): Promise<void> {
  const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId));
  const existing = lesson?.audioCacheRef ?? [];
  const withoutThisChunk = existing.filter((e) => !(e.layer === entry.layer && e.chunkIndex === entry.chunkIndex));
  await db
    .update(lessons)
    .set({ audioCacheRef: [...withoutThisChunk, entry] })
    .where(eq(lessons.id, lessonId));
}

export interface LessonChunkRef {
  layer: LessonLayerKey;
  chunkIndex: number;
  text: string;
}

export interface GetOrSynthesizeChunkOptions {
  db?: TeacherDb;
  ttsProvider: TTSProvider;
  /** Injectable for tests. Default: AUDIO_CACHE_DIR env var, or data/audio-cache. */
  cacheDir?: string;
}

export interface GetOrSynthesizeChunkResult {
  audio: Buffer;
  contentType: string;
  /** true if served from disk without a new synthesize() call — the real evidence a cache hit avoided re-calling the TTS API. */
  cacheHit: boolean;
}

/**
 * The orchestration the audio API route (app/api/lessons/[id]/audio/route.ts) actually calls:
 * check the per-chunk DB index for a matching (layer, chunkIndex) entry whose contentHash matches
 * this chunk's CURRENT text — if the file is also still present on disk, that's a genuine cache
 * hit (PRD §5.6: "Audio cached per lesson to avoid regenerating on replay"). Otherwise, call the
 * provider, write the file, and record the new entry (replacing any stale one for this
 * layer/chunkIndex — a hash mismatch means the underlying text changed, so the old file is simply
 * superseded, not read).
 */
export async function getOrSynthesizeChunk(
  lessonId: string,
  chunk: LessonChunkRef,
  options: GetOrSynthesizeChunkOptions
): Promise<GetOrSynthesizeChunkResult> {
  const db = options.db ?? (await getDb());
  const cacheDir = options.cacheDir ?? CACHE_ROOT;
  const contentHash = contentHashFor(chunk.text);

  const existing = await findCacheEntry(db, lessonId, chunk.layer, chunk.chunkIndex);
  if (existing && existing.contentHash === contentHash) {
    const cached = await readCachedFile(existing.filePath);
    if (cached) {
      const extension = path.extname(existing.filePath).slice(1);
      const contentType =
        Object.entries(EXTENSION_BY_CONTENT_TYPE).find(([, ext]) => ext === extension)?.[0] ?? "audio/mpeg";
      return { audio: cached, contentType, cacheHit: true };
    }
  }

  const { audio, contentType } = await options.ttsProvider.synthesize(chunk.text);
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType] ?? "mp3";
  const filePath = cacheFilePath(cacheDir, lessonId, contentHash, extension);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, audio);
  await recordCacheEntry(db, lessonId, { layer: chunk.layer, chunkIndex: chunk.chunkIndex, contentHash, filePath });

  return { audio, contentType, cacheHit: false };
}
