import { runDialogueTurn } from "../../../../../src/practiceEngine/index.js";
import { getPracticeSession, updatePracticeSession } from "../../_sessionStore.js";

export const runtime = "nodejs";

/** Thin wrapper over runDialogueTurn() — one turn of a simulation/debate practice session, appending to the in-memory session's stored history. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const sessionId = (await params).id;
  const state = getPracticeSession(sessionId);
  if (!state) {
    return Response.json({ message: `No practice session found with id "${sessionId}".` }, { status: 404 });
  }

  const body = (await request.json()) as { input?: string };
  const userInput = body.input?.trim();
  if (!userInput) {
    return Response.json({ message: "Missing required 'input' field." }, { status: 400 });
  }

  const reply = await runDialogueTurn(state.session, state.history, userInput);
  const nextHistory = [...state.history, { speaker: "user" as const, text: userInput }, { speaker: "ai" as const, text: reply }];
  updatePracticeSession(sessionId, { history: nextHistory });

  return Response.json({ reply, history: nextHistory });
}
