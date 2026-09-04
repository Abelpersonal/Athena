import { scoreAndRecordQuiz, QuizEngineError, type QuizQuestion, type QuizAnswer } from "../../../../../src/quizEngine/index.js";

export const runtime = "nodejs";

/** Thin wrapper over scoreAndRecordQuiz(). Body: { questions: QuizQuestion[], answers: QuizAnswer[] } — the client passes back exactly what /generate returned plus its captured answers (no server-side quiz-session state, same "don't persist what doesn't need to survive a refresh" judgment as the Practice session store). */
export async function POST(request: Request, { params }: { params: Promise<{ lessonId: string }> }): Promise<Response> {
  const { lessonId } = await params;
  const body = (await request.json()) as { questions?: QuizQuestion[]; answers?: QuizAnswer[] };
  if (!body.questions || !body.answers) {
    return Response.json({ message: "Missing required 'questions' and 'answers' fields." }, { status: 400 });
  }

  try {
    const result = await scoreAndRecordQuiz(lessonId, body.questions, body.answers);
    return Response.json(result);
  } catch (error) {
    if (error instanceof QuizEngineError) {
      return Response.json({ message: error.message }, { status: 404 });
    }
    throw error;
  }
}
