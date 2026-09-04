import { recordPracticeAttempt } from "../../../../../src/practiceEngine/index.js";
import { getPracticeSession, deletePracticeSession } from "../../_sessionStore.js";

export const runtime = "nodejs";

/** Thin wrapper over recordPracticeAttempt() — the final step, using the critique/score /submit already computed and stored. Cleans up the in-memory session once persisted. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const sessionId = (await params).id;
  const state = getPracticeSession(sessionId);
  if (!state) {
    return Response.json({ message: `No practice session found with id "${sessionId}".` }, { status: 404 });
  }
  if (state.critique === undefined || state.performanceScore === undefined) {
    return Response.json({ message: "This session hasn't been submitted yet — call /submit first." }, { status: 400 });
  }

  const body = (await request.json()) as { reflectionNotes?: string };
  const reflectionNotes = body.reflectionNotes?.trim() ?? "";

  const result = await recordPracticeAttempt(state.session, state.critique, reflectionNotes, state.performanceScore);
  deletePracticeSession(sessionId);

  return Response.json(result);
}
