import { answerLessonQuestion, TeachingEngineError } from "../../../../../src/teachingEngine/answerLessonQuestion.js";

export const runtime = "nodejs";

/** Thin wrapper over answerLessonQuestion() — the Lesson screen's text-question Q&A. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const body = (await request.json()) as { question?: string };
  const question = body.question?.trim();
  if (!question) {
    return Response.json({ message: "Missing required 'question' field." }, { status: 400 });
  }

  try {
    const result = await answerLessonQuestion(id, question);
    return Response.json(result);
  } catch (error) {
    if (error instanceof TeachingEngineError) {
      return Response.json({ message: error.message }, { status: 404 });
    }
    throw error;
  }
}
