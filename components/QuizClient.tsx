"use client";

import { useState } from "react";
import Link from "next/link";

type QuizTier = "recall" | "application" | "transfer";
interface MultipleChoiceQuestion {
  id: string;
  tier: QuizTier;
  type: "multiple_choice";
  prompt: string;
  options: string[];
  correctOptionIndex: number;
}
interface FreeTextQuestion {
  id: string;
  tier: QuizTier;
  type: "free_text";
  prompt: string;
  rubric: string;
}
type QuizQuestion = MultipleChoiceQuestion | FreeTextQuestion;

interface QuizResult {
  tierScores: Partial<Record<QuizTier, number>>;
  overallScore: number;
  weakConceptNodes: string[];
  masteryState: { knowledgeScore: number | null; experienceScore: number | null };
  courseCompleted?: string;
}

const TIER_COLOR: Record<QuizTier, string> = {
  recall: "text-[var(--color-accent)] border-[var(--color-accent)]/40",
  application: "text-[var(--color-warn)] border-[var(--color-warn)]/40",
  transfer: "text-[var(--color-danger)] border-[var(--color-danger)]/40",
};

/**
 * The Quiz screen: generateQuizQuestions() -> present -> capture answers -> scoreAndRecordQuiz()
 * -> score + updated mastery, the same flow the harness's `quiz` command runs end-to-end, now a
 * real multi-step form instead of readline prompts. Tiers are visually distinct per §6.2 screen 7.
 */
export function QuizClient({ lessonId, courseId }: { lessonId: string; courseId: string }) {
  const [phase, setPhase] = useState<"start" | "answering" | "scored">("start");
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/quiz/${lessonId}/generate`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to generate quiz questions.");
      const data = (await res.json()) as { questions: QuizQuestion[] };
      setQuestions(data.questions);
      setPhase("answering");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const payloadAnswers = questions.map((q) => ({ questionId: q.id, answer: answers[q.id] ?? "" }));
      const res = await fetch(`/api/quiz/${lessonId}/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions, answers: payloadAnswers }),
      });
      if (!res.ok) throw new Error("Failed to score the quiz.");
      setResult((await res.json()) as QuizResult);
      setPhase("scored");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const allAnswered = questions.every((q) => answers[q.id] !== undefined && answers[q.id] !== "");

  if (phase === "start") {
    return (
      <div className="space-y-3">
        <button
          onClick={start}
          disabled={loading}
          className="rounded-md bg-[var(--color-accent)] text-[#0b0e12] px-4 py-2 font-medium disabled:opacity-50"
        >
          {loading ? "Generating…" : "Start quiz"}
        </button>
        {error && <p className="text-[var(--color-danger)] text-sm">{error}</p>}
      </div>
    );
  }

  if (phase === "answering") {
    return (
      <div className="space-y-6">
        {questions.map((q, i) => (
          <div key={q.id} className="rounded-lg border border-[var(--color-border)] p-4">
            <span className={`inline-block text-xs rounded-full border px-2 py-0.5 mb-2 ${TIER_COLOR[q.tier]}`}>
              {q.tier}
            </span>
            <p className="mb-3">
              {i + 1}. {q.prompt}
            </p>
            {q.type === "multiple_choice" ? (
              <div className="space-y-1">
                {q.options.map((opt, idx) => (
                  <label key={idx} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name={q.id}
                      checked={answers[q.id] === idx}
                      onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: idx }))}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            ) : (
              <textarea
                value={(answers[q.id] as string) ?? ""}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                rows={3}
                placeholder="Your answer…"
              />
            )}
          </div>
        ))}
        <button
          onClick={submit}
          disabled={loading || !allAnswered}
          className="rounded-md bg-[var(--color-accent)] text-[#0b0e12] px-4 py-2 font-medium disabled:opacity-50"
        >
          {loading ? "Scoring…" : "Submit"}
        </button>
        {error && <p className="text-[var(--color-danger)] text-sm">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-lg">Overall: {(result!.overallScore * 100).toFixed(0)}%</p>
      <ul className="text-sm text-[var(--color-text-muted)]">
        {Object.entries(result!.tierScores).map(([tier, score]) => (
          <li key={tier}>
            {tier}: {((score ?? 0) * 100).toFixed(0)}%
          </li>
        ))}
      </ul>
      {result!.courseCompleted && (
        <p className="text-[var(--color-accent)] text-sm">
          Course complete! Suggestions are now available from the{" "}
          <Link href="/" className="underline">
            Dashboard
          </Link>
          .
        </p>
      )}
      <Link href={`/courses/${courseId}`} className="inline-block text-sm underline text-[var(--color-text-muted)]">
        Back to course
      </Link>
    </div>
  );
}
