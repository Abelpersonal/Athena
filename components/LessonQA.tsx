"use client";

import { useState } from "react";
import type { AudioPlayerMode } from "./AudioPlayer.js";
import { enqueueOutboxItem } from "../lib/offline/db.js";
import { registerBackgroundSync } from "../lib/offline/sync.js";

interface AnswerResult {
  answer: string;
  sourceIds: string[];
  outsideLessonScope: boolean;
}

/**
 * The Lesson screen's text-question Q&A — real, grounded (src/teachingEngine/answerLessonQuestion.ts).
 * Socratic checkpoints stay TEXT-INPUT (PRD §5.1/§5.6, explicit — voice is output-only, never
 * speech-to-text). Phase 7.5's addition: a "Speak answers" toggle (default off, so Phase 7's
 * text-only behavior is unchanged unless the learner opts in) — when on, the answer is spoken via
 * the same mode-aware path `AudioPlayer` uses (client-side `speechSynthesis` in "browser" mode,
 * `/api/lessons/:id/audio/adhoc` — uncached, since a Q&A answer is unique per question — in
 * "server" mode), a thin addition to the existing flow, not a rebuild of it.
 */
export function LessonQA({ lessonId, ttsMode }: { lessonId: string; ttsMode: AudioPlayerMode }) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<AnswerResult | null>(null);
  const [queued, setQueued] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiceContinuous, setVoiceContinuous] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  async function speak(text: string): Promise<void> {
    setSpeaking(true);
    try {
      if (ttsMode === "browser") {
        await new Promise<void>((resolve) => {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.onend = () => resolve();
          utterance.onerror = () => resolve();
          window.speechSynthesis.speak(utterance);
        });
      } else {
        const res = await fetch(`/api/lessons/${lessonId}/audio/adhoc`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) return;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        await new Promise<void>((resolve) => {
          const audio = new Audio(url);
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          audio.play().catch(() => resolve());
        });
        URL.revokeObjectURL(url);
      }
    } finally {
      setSpeaking(false);
    }
  }

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setAsking(true);
    setError(null);
    setAnswer(null);
    setQueued(null);
    const askedQuestion = question;
    try {
      const res = await fetch(`/api/lessons/${lessonId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: askedQuestion }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? "Failed to get an answer.");
      }
      const result = (await res.json()) as AnswerResult;
      setAnswer(result);
      if (voiceContinuous) void speak(result.answer);
    } catch (e) {
      // A genuine network failure (offline, or a downloaded-but-unreachable server) — a NEW
      // question needs a real LLM call, which can't run offline (PRD §6.4's own hard boundary),
      // so it's queued instead of shown as an error (Phase 10, Deliverable 4).
      if (e instanceof TypeError) {
        await enqueueOutboxItem({
          id: `ob_${crypto.randomUUID()}`,
          type: "ask_question",
          url: `/api/lessons/${lessonId}/ask`,
          payload: { question: askedQuestion },
          createdAt: new Date().toISOString(),
        });
        void registerBackgroundSync();
        setQueued(askedQuestion);
        setQuestion("");
      } else {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-[var(--color-text-muted)]">Ask a question</h2>
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-faint)]">
          <input
            type="checkbox"
            checked={voiceContinuous}
            onChange={(e) => setVoiceContinuous(e.target.checked)}
          />
          Speak answers
        </label>
      </div>
      <form onSubmit={ask} className="flex gap-2">
        <label htmlFor="lesson-question" className="sr-only">
          Ask about this lesson
        </label>
        <input
          id="lesson-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about this lesson…"
          className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
          disabled={asking}
        />
        <button
          type="submit"
          disabled={asking || !question.trim()}
          aria-busy={asking}
          className="min-h-11 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm hover:border-[var(--color-accent)] disabled:opacity-50"
        >
          {asking ? "Asking…" : "Ask"}
        </button>
      </form>
      {error && (
        <p className="text-[var(--color-danger)] text-sm" role="alert">
          {error}
        </p>
      )}
      {queued && (
        <div className="rounded-lg border border-[var(--color-warn)]/40 p-3 text-sm" role="status" aria-live="polite">
          <p className="text-[var(--color-warn)] font-medium">Queued — will answer when back online</p>
          <p className="text-[var(--color-text-muted)] mt-1">&quot;{queued}&quot;</p>
        </div>
      )}
      {answer && (
        <div className="rounded-lg border border-[var(--color-border)] p-3 text-sm" role="status" aria-live="polite">
          <p>{answer.answer}</p>
          {speaking && <p className="text-[var(--color-text-faint)] mt-1">Speaking…</p>}
          {answer.outsideLessonScope && (
            <p className="text-[var(--color-text-faint)] mt-1">(This goes beyond what this lesson covers.)</p>
          )}
        </div>
      )}
    </div>
  );
}
