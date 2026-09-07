"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useProgressStream, ProgressLog } from "../../components/ProgressStream.js";
import { STARTING_MENU, STARTING_MENU_CATEGORIES } from "../../src/startingMenu/data.js";

interface ClassifyResult {
  classification: "topic" | "goal";
  reasoning: string;
}

/**
 * The topic/goal entry screen. Classification is ALWAYS confirmed or overridden by the user
 * before anything is generated — this is a hard UX requirement carried over from Phase 5's CLI
 * harness (`goal "<input>"` never proceeds silently), not optional polish. The model's own call is
 * shown with its reasoning; the user picks "Build one course" or "Build a full path" explicitly,
 * and an override (picking the opposite of what the model said) is a first-class, equally
 * supported path, not a hidden escape hatch.
 */
export default function NewEntryPage() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [classifying, setClassifying] = useState(false);
  const [classification, setClassification] = useState<ClassifyResult | null>(null);
  const [choice, setChoice] = useState<"topic" | "goal" | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamKind = choice; // "topic" -> build-stream, "goal" -> decompose-stream
  const stream = useProgressStream<Record<string, unknown>>(streamUrl);

  if (stream.finished && stream.result && !stream.error) {
    const result = stream.result;
    if (streamKind === "topic" && typeof result.courseId === "string") {
      router.push(`/courses/${result.courseId}`);
    } else if (streamKind === "goal" && typeof result.pathId === "string") {
      router.push(`/paths/${result.pathId}`);
    }
  }

  async function submitInput(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setClassifying(true);
    setError(null);
    try {
      const res = await fetch("/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      if (!res.ok) throw new Error("Classification failed.");
      const data = (await res.json()) as ClassifyResult;
      setClassification(data);
      setChoice(data.classification);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setClassifying(false);
    }
  }

  function confirmAndGenerate() {
    if (!choice) return;
    const url =
      choice === "topic"
        ? `/api/courses/build-stream?topic=${encodeURIComponent(input)}`
        : `/api/paths/decompose-stream?goalDescription=${encodeURIComponent(input)}`;
    setStreamUrl(url);
  }

  if (streamUrl) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-medium">
          {streamKind === "topic" ? "Building your course…" : "Decomposing your path…"}
        </h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          This takes a few minutes — multi-pass research and a depth audit run for every subtopic.
        </p>
        <ProgressLog lines={stream.lines} />
        {stream.error && (
          <p className="text-[var(--color-danger)] text-sm" role="alert">
            {stream.error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-xl">
      <h1 className="text-xl font-medium">What do you want to learn?</h1>

      <form onSubmit={submitInput} className="space-y-3">
        <label htmlFor="new-entry-input" className="sr-only">
          What do you want to learn?
        </label>
        <input
          id="new-entry-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='e.g. "Special Relativity" or "become a full-stack quant"'
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
          disabled={classifying || classification !== null}
        />
        {!classification && (
          <button
            type="submit"
            disabled={classifying || !input.trim()}
            aria-busy={classifying}
            className="min-h-11 rounded-md bg-[var(--color-accent)] text-[#0b0e12] px-4 py-2 font-medium disabled:opacity-50"
          >
            {classifying ? "Thinking…" : "Continue"}
          </button>
        )}
      </form>

      {!classification && (
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">…or pick something to start with</p>
          {STARTING_MENU_CATEGORIES.map((category) => (
            <div key={category}>
              <h2 className="text-xs uppercase tracking-wide text-[var(--color-text-faint)] mb-1.5">{category}</h2>
              <div className="flex flex-wrap gap-1.5">
                {STARTING_MENU.filter((entry) => entry.category === category).map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setInput(entry.prompt)}
                    disabled={classifying}
                    className="min-h-11 text-xs px-2.5 py-1 rounded-full border border-[var(--color-border)] hover:border-[var(--color-accent)] disabled:opacity-50"
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="text-[var(--color-danger)] text-sm" role="alert">
          {error}
        </p>
      )}

      {classification && (
        <div className="rounded-lg border border-[var(--color-border)] p-4 space-y-3">
          <p className="text-sm text-[var(--color-text-muted)]">
            This looks like a {classification.classification === "goal" ? "big goal" : "single topic"}.
          </p>
          <p className="text-sm">{classification.reasoning}</p>

          <div className="flex gap-3 pt-2" role="group" aria-label="Confirm or override the classification">
            <button
              onClick={() => setChoice("topic")}
              aria-pressed={choice === "topic"}
              className={`min-h-11 px-3 py-1.5 rounded-md border text-sm ${
                choice === "topic" ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-[var(--color-border)]"
              }`}
            >
              Build one course
            </button>
            <button
              onClick={() => setChoice("goal")}
              aria-pressed={choice === "goal"}
              className={`min-h-11 px-3 py-1.5 rounded-md border text-sm ${
                choice === "goal" ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-[var(--color-border)]"
              }`}
            >
              Build a full path
            </button>
          </div>

          <button
            onClick={confirmAndGenerate}
            className="min-h-11 mt-2 rounded-md bg-[var(--color-accent)] text-[#0b0e12] px-4 py-2 font-medium"
          >
            Confirm and start
          </button>
        </div>
      )}
    </div>
  );
}
