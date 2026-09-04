import { getTtsProvider } from "../../../../../../src/teachingEngine/tts/index.js";

export const runtime = "nodejs";

/**
 * Thin wrapper for voice-continuous Q&A (LessonQA's voice toggle) — synthesizes arbitrary text
 * (an answerLessonQuestion() response) directly, UNCACHED: a Q&A answer is unique per question,
 * so content-hash caching (the lesson-chunk path's whole point) doesn't apply the same way here.
 * The `[id]` lesson segment isn't used by the synthesis call itself (kept for a consistent,
 * lesson-scoped URL shape alongside the cached chunk route).
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as { text?: string };
  const text = body.text?.trim();
  if (!text) {
    return Response.json({ message: "Missing required 'text' field." }, { status: 400 });
  }

  const result = await getTtsProvider().synthesize(text);
  return new Response(new Uint8Array(result.audio), {
    headers: { "Content-Type": result.contentType },
  });
}
