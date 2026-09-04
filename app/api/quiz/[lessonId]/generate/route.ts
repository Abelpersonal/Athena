import { generateQuizQuestions, ALL_QUIZ_TIERS, QuizEngineError, type QuizTier } from "../../../../../src/quizEngine/index.js";

export const runtime = "nodejs";

/**
 * Thin wrapper over generateQuizQuestions(). Body: { tiers?: QuizTier[], questionsPerTier?: number }
 * — omit tiers for all three; questionsPerTier lets the Dashboard's Phase 9 "5-minute check-in"
 * low-friction re-entry offer (src/motivation/) request a single-question session on one tier
 * without a second quiz-generation path.
 */
export async function POST(request: Request, { params }: { params: Promise<{ lessonId: string }> }): Promise<Response> {
  const { lessonId } = await params;
  const body = (await request.json().catch(() => ({}))) as { tiers?: QuizTier[]; questionsPerTier?: number };
  const tiers = body.tiers && body.tiers.length > 0 ? body.tiers : ALL_QUIZ_TIERS;

  try {
    const questions = await generateQuizQuestions(lessonId, tiers, body.questionsPerTier ? { questionsPerTier: body.questionsPerTier } : {});
    return Response.json({ questions });
  } catch (error) {
    if (error instanceof QuizEngineError) {
      return Response.json({ message: error.message }, { status: 404 });
    }
    throw error;
  }
}
