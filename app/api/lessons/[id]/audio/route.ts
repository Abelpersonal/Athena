import { chunkLessonAudio, LESSON_LAYER_ORDER, type LessonLayerKey } from "../../../../../src/teachingEngine/chunkLessonAudio.js";
import { getOrSynthesizeChunk } from "../../../../../src/teachingEngine/audioCache.js";
import { getTtsProvider } from "../../../../../src/teachingEngine/tts/index.js";
import { getDb } from "../../../../../src/db/client.js";
import { lessons } from "../../../../../src/db/schema.js";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

/**
 * Thin wrapper: locate the requested chunk (via the SAME chunkLessonAudio() the Lesson page uses
 * to build the track client-side, so indices always agree), then getOrSynthesizeChunk() — cache
 * check, TTS call on a miss, cache write — and stream the raw bytes back. A real HTTP GET
 * returning audio/mpeg (not SSE) so the browser's own <audio> element and HTTP cache do the work;
 * see README, "Audio delivery: per-chunk GET, not SSE" for why this deliberately differs from
 * Phase 7's SSE progress-log routes.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const url = new URL(request.url);
  const layer = url.searchParams.get("layer") as LessonLayerKey | null;
  const chunkIndexRaw = url.searchParams.get("chunkIndex");

  if (!layer || !LESSON_LAYER_ORDER.includes(layer) || chunkIndexRaw === null) {
    return Response.json({ message: "Missing or invalid 'layer'/'chunkIndex' query parameters." }, { status: 400 });
  }
  const chunkIndex = Number(chunkIndexRaw);

  const db = await getDb();
  const [lesson] = await db.select().from(lessons).where(eq(lessons.id, id));
  if (!lesson) {
    return Response.json({ message: `No lesson found with id "${id}".` }, { status: 404 });
  }

  const track = chunkLessonAudio(id, lesson.layers);
  const chunk = track.chunks.find((c) => c.layer === layer && c.chunkIndex === chunkIndex);
  if (!chunk) {
    return Response.json({ message: `No chunk found for layer "${layer}", chunkIndex ${chunkIndex}.` }, { status: 404 });
  }

  const result = await getOrSynthesizeChunk(id, chunk, { db, ttsProvider: getTtsProvider() });
  return new Response(new Uint8Array(result.audio), {
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": "private, max-age=31536000, immutable", // content-hash-keyed — safe to cache indefinitely once served
      "X-Cache": result.cacheHit ? "HIT" : "MISS",
    },
  });
}
