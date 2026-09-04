import { critiquePracticeAttempt, generateReflectionPromptText } from "../../../../../src/practiceEngine/index.js";
import { getPracticeSession, updatePracticeSession } from "../../_sessionStore.js";

export const runtime = "nodejs";

/** Same transcript join the CLI harness's runDialogueLoop uses (src/harness/cli.ts) — kept identical so a dialogue-format critique reads the same way through either interface. */
function transcriptFromHistory(history: { speaker: "user" | "ai"; text: string }[]): string {
  return history.map((h) => `${h.speaker === "user" ? "Learner" : "Counterpart"}: ${h.text}`).join("\n");
}

/**
 * Thin wrapper over critiquePracticeAttempt() + generateReflectionPromptText() — the "learner
 * submitted their attempt" step, splitting the prompt's suggested single "finish" endpoint into
 * submit+reflect to match the real CLI flow (critique/score shown, THEN a reflection prompt is
 * generated, THEN the learner reflects, THEN recordPracticeAttempt runs — see /reflect).
 * For "project" format, `userOutput` is the client's captured multi-line submission directly; for
 * "simulation"/"debate", the transcript is built from the session's own stored dialogue history,
 * not re-sent by the client.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const sessionId = (await params).id;
  const state = getPracticeSession(sessionId);
  if (!state) {
    return Response.json({ message: `No practice session found with id "${sessionId}".` }, { status: 404 });
  }

  let userOutput: string;
  if (state.session.format === "project") {
    const body = (await request.json()) as { userOutput?: string };
    userOutput = body.userOutput?.trim() ?? "";
    if (!userOutput) {
      return Response.json({ message: "Missing required 'userOutput' field." }, { status: 400 });
    }
  } else {
    userOutput = transcriptFromHistory(state.history);
  }

  const { critique, performanceScore } = await critiquePracticeAttempt(state.session, userOutput);
  const reflectionPrompt = await generateReflectionPromptText(state.session, critique);

  updatePracticeSession(sessionId, { critique, performanceScore, reflectionPrompt });

  return Response.json({ critique, performanceScore, reflectionPrompt });
}
