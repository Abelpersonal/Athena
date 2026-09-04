"use client";

import { useState } from "react";

interface AnswerResult {
  answer: string;
  sourceIds: string[];
  outsideLessonScope: boolean;
}

/** The Lesson screen's text-question Q&A — real, grounded (src/teachingEngine/answerLessonQuestion.ts). */
export function LessonQA({ lessonId }: { lessonId: string }) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<AnswerResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setAsking(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await fetch(`/api/lessons/${lessonId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? "Failed to get an answer.");
      }
      setAnswer((await res.json()) as AnswerResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-[var(--color-text-muted)]">Ask a question</h3>
      <form onSubmit={ask} className="flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about this lesson…"
          className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
          disabled={asking}
        />
        <button
          type="submit"
          disabled={asking || !question.trim()}
          className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm hover:border-[var(--color-accent)] disabled:opacity-50"
        >
          {asking ? "…" : "Ask"}
        </button>
      </form>
      {error && <p className="text-[var(--color-danger)] text-sm">{error}</p>}
      {answer && (
        <div className="rounded-lg border border-[var(--color-border)] p-3 text-sm">
          <p>{answer.answer}</p>
          {answer.outsideLessonScope && (
            <p className="text-[var(--color-text-faint)] mt-1">(This goes beyond what this lesson covers.)</p>
          )}
        </div>
      )}
    </div>
  );
}
