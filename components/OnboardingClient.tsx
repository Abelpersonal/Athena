"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Deliverable 1's resolution of PRD Open Decision 10: 3-5 short free-text prompts, not a structured taxonomy — see README. */
const PROMPTS = [
  "What are you hoping to get better at?",
  "Why does that matter to you?",
  "Is there something specific you're working toward?",
  "What would \"better\" actually look like, a few months from now?",
];

/**
 * Deliverable 1: §6.2 screen 1's "short, honest capture," not a long form. Each non-empty answer
 * becomes one entry in UserProfile.statedGoals. First-run (no `initialGoals`) shows "Skip for
 * now," which saves an empty array — a row existing at all is what stops the Dashboard's
 * first-run redirect from firing again. Revisiting later to edit shows "Cancel" instead, which
 * navigates away without overwriting anything already saved.
 */
export function OnboardingClient({ initialGoals }: { initialGoals: string[] }) {
  const router = useRouter();
  const isEditing = initialGoals.length > 0;
  const [answers, setAnswers] = useState<string[]>(() => {
    const seeded = [...initialGoals];
    while (seeded.length < PROMPTS.length) seeded.push("");
    return seeded.slice(0, PROMPTS.length);
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(statedGoals: string[]) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statedGoals }),
      });
      if (!res.ok) throw new Error("Failed to save.");
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void save(answers.map((a) => a.trim()).filter(Boolean));
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-medium">A few honest questions</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          Totally optional, and you can change these any time — this just helps connect what
          you&apos;re learning back to why it matters to you.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        {PROMPTS.map((prompt, i) => (
          <div key={prompt}>
            <label className="block text-sm mb-1">{prompt}</label>
            <textarea
              value={answers[i]}
              onChange={(e) => setAnswers((prev) => prev.map((a, idx) => (idx === i ? e.target.value : a)))}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
              rows={2}
            />
          </div>
        ))}
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-[var(--color-accent)] text-[#0b0e12] px-4 py-2 font-medium disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {isEditing ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => router.push("/")}
              className="text-sm px-4 py-2 rounded-md border border-[var(--color-border)] disabled:opacity-50"
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={() => void save([])}
              className="text-sm px-4 py-2 rounded-md border border-[var(--color-border)] disabled:opacity-50"
            >
              Skip for now
            </button>
          )}
        </div>
        {error && <p className="text-[var(--color-danger)] text-sm">{error}</p>}
      </form>
    </div>
  );
}
