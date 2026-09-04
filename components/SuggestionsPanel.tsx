"use client";

import { useState } from "react";

interface BookRec {
  title: string;
  author: string;
  category: "core" | "optional_deep_dive" | "primary_source";
  rationale: string;
  gutenbergUrl?: string;
}
interface TopicSuggestion {
  topicName: string;
  description: string;
  rationale: string;
}
interface SuggestionsResult {
  books: { persisted: BookRec[]; rejected: { title: string; reason: string }[] };
  topicSuggestions: {
    deepen: TopicSuggestion;
    branch: TopicSuggestion & { domain: string };
    diversityBiasApplied: boolean;
  };
}

/**
 * On-demand suggestions — runs runContinuousLearningAgent() via POST /api/courses/:id/suggestions
 * only when clicked (matches Phase 6's "recompute fresh each time, don't persist Suggestion
 * records" decision — nothing here is eagerly computed for every completed course on page load).
 */
export function SuggestionsPanel({ courseId }: { courseId: string }) {
  const [result, setResult] = useState<SuggestionsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function getSuggestions() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/suggestions`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? "Failed to generate suggestions.");
      }
      setResult((await res.json()) as SuggestionsResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  if (!result) {
    return (
      <button
        onClick={getSuggestions}
        disabled={loading}
        className="text-sm px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:border-[var(--color-accent)] disabled:opacity-50"
      >
        {loading ? "Thinking…" : "Get suggestions"}
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-3 text-sm">
      {error && <p className="text-[var(--color-danger)]">{error}</p>}

      {result.books.persisted.length > 0 && (
        <div>
          <h4 className="text-[var(--color-text-muted)] mb-1">Worth reading next</h4>
          <ul className="space-y-1">
            {result.books.persisted.map((b) => (
              <li key={b.title}>
                <span className="text-[var(--color-text-faint)]">[{b.category}]</span> {b.title} — {b.author}
                {b.gutenbergUrl && (
                  <>
                    {" "}
                    (
                    <a href={b.gutenbergUrl} target="_blank" rel="noreferrer" className="text-[var(--color-accent)]">
                      free text
                    </a>
                    )
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h4 className="text-[var(--color-text-muted)] mb-1">Where to go next</h4>
        <p>
          <span className="text-[var(--color-text-faint)]">Deepen:</span> {result.topicSuggestions.deepen.topicName}
          {" — "}
          {result.topicSuggestions.deepen.rationale}
        </p>
        <p>
          <span className="text-[var(--color-text-faint)]">Branch ({result.topicSuggestions.branch.domain}):</span>{" "}
          {result.topicSuggestions.branch.topicName} — {result.topicSuggestions.branch.rationale}
        </p>
      </div>
    </div>
  );
}
