import { preparePracticeSession, PracticeEngineError } from "../../../../../src/practiceEngine/index.js";
import { createPracticeSession } from "../../_sessionStore.js";

export const runtime = "nodejs";

/** Thin wrapper over preparePracticeSession() — creates the in-memory session the rest of the Practice screen's calls key off of. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const moduleId = (await params).id;

  try {
    const session = await preparePracticeSession(moduleId);
    const sessionId = createPracticeSession(session);
    return Response.json({ sessionId, session });
  } catch (error) {
    if (error instanceof PracticeEngineError) {
      return Response.json({ message: error.message }, { status: 404 });
    }
    throw error;
  }
}
