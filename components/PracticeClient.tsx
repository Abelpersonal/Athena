"use client";

import { useState } from "react";
import Link from "next/link";

type PracticeFormat = "project" | "simulation" | "debate";
interface PracticeSession {
  moduleId: string;
  moduleTitle: string;
  topicType: string;
  format: PracticeFormat;
  formatJustification: string;
  difficulty: string;
  attemptNumber: number;
  project?: { task: string; datasetOrPrompt: string; deliverableExpectations: string };
  simulation?: { scenario: string; personaName: string; personaRole: string; openingLine: string };
  debate?: { claim: string; userPosition: "for" | "against"; openingArgument: string };
}
interface DialogueTurn {
  speaker: "user" | "ai";
  text: string;
}
interface SubmitResult {
  critique: string;
  performanceScore: number;
  reflectionPrompt: string;
}
interface ReflectResult {
  attemptId: string;
  updatedLessonIds: string[];
  willEscalateNextAttempt: boolean;
}

/**
 * The Practice screen — chat/scenario-style, minimal chrome, per §6.2 screen 6. Drives
 * preparePracticeSession -> (multi-turn runDialogueTurn for simulation/debate, or a direct
 * submission for project) -> critiquePracticeAttempt + generateReflectionPromptText (the /submit
 * route) -> recordPracticeAttempt (the /reflect route), the same chain the harness's `practice`
 * command runs, as a real chat UI instead of CLI turns.
 */
export function PracticeClient({ moduleId, courseId }: { moduleId: string; courseId: string }) {
  const [phase, setPhase] = useState<"start" | "active" | "submitted" | "done">("start");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [history, setHistory] = useState<DialogueTurn[]>([]);
  const [turnInput, setTurnInput] = useState("");
  const [projectSubmission, setProjectSubmission] = useState("");
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [reflectionNotes, setReflectionNotes] = useState("");
  const [finalResult, setFinalResult] = useState<ReflectResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/practice/${moduleId}/start`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? "Failed to start a practice session.");
      }
      const data = (await res.json()) as { sessionId: string; session: PracticeSession };
      setSessionId(data.sessionId);
      setSession(data.session);
      if (data.session.format !== "project") {
        const opening = data.session.simulation?.openingLine ?? data.session.debate?.openingArgument ?? "";
        setHistory([{ speaker: "ai", text: opening }]);
      }
      setPhase("active");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function sendTurn(e: React.FormEvent) {
    e.preventDefault();
    if (!turnInput.trim() || !sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/practice/${sessionId}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: turnInput }),
      });
      if (!res.ok) throw new Error("Failed to send that turn.");
      const data = (await res.json()) as { history: DialogueTurn[] };
      setHistory(data.history);
      setTurnInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function submitAttempt() {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/practice/${sessionId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(session?.format === "project" ? { userOutput: projectSubmission } : {}),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? "Failed to submit.");
      }
      setSubmitResult((await res.json()) as SubmitResult);
      setPhase("submitted");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function reflect(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/practice/${sessionId}/reflect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reflectionNotes }),
      });
      if (!res.ok) throw new Error("Failed to record this attempt.");
      setFinalResult((await res.json()) as ReflectResult);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  if (phase === "start") {
    return (
      <div className="space-y-3">
        <button
          onClick={start}
          disabled={loading}
          className="rounded-md bg-[var(--color-accent)] text-[#0b0e12] px-4 py-2 font-medium disabled:opacity-50"
        >
          {loading ? "Preparing…" : "Start practice"}
        </button>
        {error && <p className="text-[var(--color-danger)] text-sm">{error}</p>}
      </div>
    );
  }

  if (phase === "active" && session) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-[var(--color-border)] p-4 text-sm">
          {session.format === "project" && session.project && (
            <>
              <p className="font-medium mb-1">{session.project.task}</p>
              <p className="text-[var(--color-text-muted)]">{session.project.datasetOrPrompt}</p>
              <p className="text-[var(--color-text-faint)] mt-1">Expected: {session.project.deliverableExpectations}</p>
            </>
          )}
          {session.format === "simulation" && session.simulation && (
            <p>
              Scenario: {session.simulation.scenario} — you're talking with {session.simulation.personaName} (
              {session.simulation.personaRole})
            </p>
          )}
          {session.format === "debate" && session.debate && (
            <p>
              Claim: {session.debate.claim} — you're arguing <strong>{session.debate.userPosition}</strong>
            </p>
          )}
        </div>

        {session.format === "project" ? (
          <textarea
            value={projectSubmission}
            onChange={(e) => setProjectSubmission(e.target.value)}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
            rows={8}
            placeholder="Type your submission…"
          />
        ) : (
          <div className="space-y-3">
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {history.map((turn, i) => (
                <div
                  key={i}
                  className={`rounded-lg p-3 text-sm max-w-[85%] ${
                    turn.speaker === "user" ? "ml-auto bg-[var(--color-accent-muted)]" : "bg-[var(--color-surface-raised)]"
                  }`}
                >
                  {turn.text}
                </div>
              ))}
            </div>
            <form onSubmit={sendTurn} className="flex gap-2">
              <input
                value={turnInput}
                onChange={(e) => setTurnInput(e.target.value)}
                className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                placeholder="Your reply…"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !turnInput.trim()}
                className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm hover:border-[var(--color-accent)]"
              >
                Send
              </button>
            </form>
          </div>
        )}

        <button
          onClick={submitAttempt}
          disabled={loading || (session.format === "project" && !projectSubmission.trim())}
          className="rounded-md bg-[var(--color-accent)] text-[#0b0e12] px-4 py-2 font-medium disabled:opacity-50"
        >
          {loading ? "Submitting…" : "I'm done — submit for critique"}
        </button>
        {error && <p className="text-[var(--color-danger)] text-sm">{error}</p>}
      </div>
    );
  }

  if (phase === "submitted" && submitResult) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-[var(--color-border)] p-4">
          <p className="text-sm text-[var(--color-text-muted)] mb-1">
            Score: {(submitResult.performanceScore * 100).toFixed(0)}%
          </p>
          <p>{submitResult.critique}</p>
        </div>
        <form onSubmit={reflect} className="space-y-2">
          <label className="text-sm text-[var(--color-text-muted)]">{submitResult.reflectionPrompt}</label>
          <textarea
            value={reflectionNotes}
            onChange={(e) => setReflectionNotes(e.target.value)}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
            rows={4}
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-[var(--color-accent)] text-[#0b0e12] px-4 py-2 font-medium disabled:opacity-50"
          >
            {loading ? "Recording…" : "Finish"}
          </button>
        </form>
        {error && <p className="text-[var(--color-danger)] text-sm">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p>Attempt recorded — mastery updated for {finalResult?.updatedLessonIds.length} lesson(s).</p>
      <p className="text-sm text-[var(--color-text-muted)]">
        {finalResult?.willEscalateNextAttempt
          ? "Your next attempt on this module will be harder."
          : "You've reached the difficulty ceiling for this module."}
      </p>
      <Link href={`/courses/${courseId}`} className="inline-block text-sm underline text-[var(--color-text-muted)]">
        Back to course
      </Link>
    </div>
  );
}
