import { recordPracticeAttempt, findExistingPracticeAttempt } from "../../../../../src/practiceEngine/index.js";
import { getPracticeSession, deletePracticeSession } from "../../_sessionStore.js";

export const runtime = "nodejs";

/**
 * Thin wrapper over recordPracticeAttempt() — the final step, using the critique/score /submit
 * already computed and stored. Cleans up the in-memory session once persisted.
 *
 * SSRF Guard + Idempotent Sync Endpoints addition: the practice session's own `sessionId` (the URL
 * param) doubles as the idempotency key — it's already stable across a client retry, so no new
 * client-generated value is needed here unlike the quiz-score route. The existing-record check
 * runs BEFORE `getPracticeSession`, not after: a successful first call deletes the in-memory
 * session immediately below, so if the client never saw that response and retries, the session is
 * already gone and `getPracticeSession` would otherwise 404 before this route ever got a chance to
 * recognize the retry as a duplicate. See src/practiceEngine/index.ts's findExistingPracticeAttempt
 * doc comment for why it needs no PracticeSession to reconstruct the original result.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const sessionId = (await params).id;

  const existingResult = await findExistingPracticeAttempt(sessionId);
  if (existingResult) {
    return Response.json(existingResult);
  }

  const state = getPracticeSession(sessionId);
  if (!state) {
    return Response.json({ message: `No practice session found with id "${sessionId}".` }, { status: 404 });
  }
  if (state.critique === undefined || state.performanceScore === undefined) {
    return Response.json({ message: "This session hasn't been submitted yet — call /submit first." }, { status: 400 });
  }

  const body = (await request.json()) as { reflectionNotes?: string };
  const reflectionNotes = body.reflectionNotes?.trim() ?? "";

  const result = await recordPracticeAttempt(state.session, state.critique, reflectionNotes, state.performanceScore, {
    idempotencyKey: sessionId,
  });
  deletePracticeSession(sessionId);

  return Response.json(result);
}
