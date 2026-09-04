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
  /** Phase 9, Deliverable 5: true only on a real transfer-tier high score — one of exactly two milestone-celebration triggers. */
  transferHighScoreAchieved: boolean;
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
 * `tiers`/`questionsPerTier` (Phase 9): set by the Dashboard's "5-minute check-in" low-friction
 * re-entry offer to request a genuinely single-question, single-tier session — same generation
 * path, just parameterized differently.
 */
export function QuizClient({
  lessonId,
  courseId,
  tiers,
  questionsPerTier,
}: {
  lessonId: string;
  courseId: string;
  tiers?: QuizTier[];
  questionsPerTier?: number;
}) {
  const [phase, setPhase] = useState<"start" | "answering" | "scored">("start");
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isQuickCheckIn = Boolean(tiers && tiers.length === 1 && questionsPerTier === 1);

  async function start() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/quiz/${lessonId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(tiers ? { tiers } : {}), ...(questionsPerTier ? { questionsPerTier } : {}) }),
      });
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
          {loading ? "Generating…" : isQuickCheckIn ? "Start 5-minute check-in" : "Start quiz"}
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

  const isMilestone = Boolean(result!.courseCompleted) || result!.transferHighScoreAchieved;

  return (
    <div className="space-y-3">
      {isMilestone && (
        <div className="rounded-lg border-2 border-[var(--color-accent)] bg-[var(--color-accent)]/10 p-4 space-y-1">
          <p className="text-lg font-medium text-[var(--color-accent)]">
            {result!.courseCompleted ? "Course complete" : "Real, deep mastery"}
          </p>
          <p className="text-sm">
            {result!.courseCompleted ? (
              <>
                Every lesson in this course now has real quiz results across all three tiers —
                genuinely done. Suggestions are now available from the{" "}
                <Link href="/" className="underline">
                  Dashboard
                </Link>
                .
              </>
            ) : (
              "That transfer-tier score reflects real, applied understanding, not just recall."
            )}
          </p>
        </div>
      )}
      <p className="text-lg">Overall: {(result!.overallScore * 100).toFixed(0)}%</p>
      <ul className="text-sm text-[var(--color-text-muted)]">
        {Object.entries(result!.tierScores).map(([tier, score]) => (
          <li key={tier}>
            {tier}: {((score ?? 0) * 100).toFixed(0)}%
          </li>
        ))}
      </ul>
      <Link href={`/courses/${courseId}`} className="inline-block text-sm underline text-[var(--color-text-muted)]">
        Back to course
      </Link>
    </div>
  );
}
