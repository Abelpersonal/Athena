import { generateQuizQuestions, ALL_QUIZ_TIERS, QuizEngineError, type QuizTier } from "../../../../../src/quizEngine/index.js";

export const runtime = "nodejs";

/** Thin wrapper over generateQuizQuestions(). Body: { tiers?: QuizTier[] } — omit for all three tiers. */
export async function POST(request: Request, { params }: { params: Promise<{ lessonId: string }> }): Promise<Response> {
  const { lessonId } = await params;
  const body = (await request.json().catch(() => ({}))) as { tiers?: QuizTier[] };
  const tiers = body.tiers && body.tiers.length > 0 ? body.tiers : ALL_QUIZ_TIERS;

  try {
    const questions = await generateQuizQuestions(lessonId, tiers);
    return Response.json({ questions });
  } catch (error) {
    if (error instanceof QuizEngineError) {
      return Response.json({ message: error.message }, { status: 404 });
    }
    throw error;
  }
}
