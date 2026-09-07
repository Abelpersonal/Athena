"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useProgressStream, ProgressLog } from "../../components/ProgressStream.js";
import { STARTING_MENU, STARTING_MENU_CATEGORIES } from "../../src/startingMenu/data.js";

interface ClassifyResult {
  classification: "topic" | "goal";
  reasoning: string;
}

interface DecomposeResult {
  outcome: "normal" | "oversized";
  decompositionId: string;
  topicCount: number;
  hardLimit: number;
  domainBreakdown: Array<{ name: string; topicCount: number }>;
}

/**
 * The topic/goal entry screen. Classification is ALWAYS confirmed or overridden by the user
 * before anything is generated — this is a hard UX requirement carried over from Phase 5's CLI
 * harness (`goal "<input>"` never proceeds silently), not optional polish. The model's own call is
 * shown with its reasoning; the user picks "Build one course" or "Build a full path" explicitly,
 * and an override (picking the opposite of what the model said) is a first-class, equally
 * supported path, not a hidden escape hatch.
 *
 * Graceful Over-Large-Goal Handling addition: a "goal" choice now decomposes FIRST (a quick,
 * non-streamed `/api/paths/decompose` call — two LLM calls, not the multi-minute pipeline) before
 * anything is persisted. A normal-sized result proceeds straight to the persist stream exactly
 * like before; an oversized one shows a SECOND confirm step — proceed as one large path, split
 * into phased sub-paths, or abort — mirroring this same screen's own classify-confirm-override
 * principle rather than refusing outright or applying either choice silently.
 */
export default function NewEntryPage() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [classifying, setClassifying] = useState(false);
  const [classification, setClassification] = useState<ClassifyResult | null>(null);
  const [choice, setChoice] = useState<"topic" | "goal" | null>(null);
  const [decomposing, setDecomposing] = useState(false);
  const [oversized, setOversized] = useState<DecomposeResult | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamKind = choice; // "topic" -> build-stream, "goal" -> persist-stream
  const stream = useProgressStream<Record<string, unknown>>(streamUrl);

  if (stream.finished && stream.result && !stream.error) {
    const result = stream.result;
    if (streamKind === "topic" && typeof result.courseId === "string") {
      router.push(`/courses/${result.courseId}`);
    } else if (streamKind === "goal" && Array.isArray(result.paths) && result.paths.length > 0) {
      // Split produces 2-3 phased Paths — land on Phase 1's, the one the user tackles first.
      const first = result.paths[0] as { pathId?: string };
      if (typeof first.pathId === "string") router.push(`/paths/${first.pathId}`);
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

  async function confirmAndGenerate() {
    if (!choice) return;
    if (choice === "topic") {
      setStreamUrl(`/api/courses/build-stream?topic=${encodeURIComponent(input)}`);
      return;
    }

    setDecomposing(true);
    setError(null);
    try {
      const res = await fetch("/api/paths/decompose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalDescription: input }),
      });
      if (!res.ok) throw new Error("Decomposing the goal failed.");
      const data = (await res.json()) as DecomposeResult;
      if (data.outcome === "oversized") {
        setOversized(data);
      } else {
        startPersisting(data.decompositionId, "proceed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setDecomposing(false);
    }
  }

  function startPersisting(decompositionId: string, action: "proceed" | "split") {
    setStreamUrl(`/api/paths/persist-stream?decompositionId=${encodeURIComponent(decompositionId)}&action=${action}`);
  }

  function abortOversized() {
    // Nothing was ever persisted for an oversized decomposition — just back out to re-decide.
    setOversized(null);
  }

  if (streamUrl) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-medium">
          {streamKind === "topic" ? "Building your course…" : "Building your path…"}
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

  if (oversized) {
    return (
      <div className="space-y-4 max-w-xl">
        <h1 className="text-xl font-medium">This goal is unusually large</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          The decomposition came back with {oversized.topicCount} topics — above the usual ceiling of{" "}
          {oversized.hardLimit}. Nothing has been created yet; pick how you&apos;d like to proceed.
        </p>

        <ul className="text-sm space-y-1 rounded-lg border border-[var(--color-border)] p-3">
          {oversized.domainBreakdown.map((d) => (
            <li key={d.name} className="flex justify-between">
              <span>{d.name}</span>
              <span className="text-[var(--color-text-muted)]">{d.topicCount} topic(s)</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2 pt-2" role="group" aria-label="Proceed, split into phases, or abort">
          <button
            onClick={() => startPersisting(oversized.decompositionId, "split")}
            className="min-h-11 rounded-md bg-[var(--color-accent)] text-[#0b0e12] px-4 py-2 font-medium text-left"
          >
            Split into phased sub-paths (recommended) — tackle it 2-3 domains at a time
          </button>
          <button
            onClick={() => startPersisting(oversized.decompositionId, "proceed")}
            className="min-h-11 rounded-md border border-[var(--color-border)] px-4 py-2 text-left"
          >
            Proceed anyway as one large path
          </button>
          <button onClick={abortOversized} className="min-h-11 rounded-md border border-[var(--color-border)] px-4 py-2 text-left">
            Abort — let me rethink the goal
          </button>
        </div>

        {error && (
          <p className="text-[var(--color-danger)] text-sm" role="alert">
            {error}
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
            disabled={decomposing}
            aria-busy={decomposing}
            className="min-h-11 mt-2 rounded-md bg-[var(--color-accent)] text-[#0b0e12] px-4 py-2 font-medium disabled:opacity-50"
          >
            {decomposing ? "Decomposing…" : "Confirm and start"}
          </button>
        </div>
      )}
    </div>
  );
}
