import type { LessonSourceRef } from "../src/db/queries.js";

/** Source citations, shown on demand (a <details> disclosure) — per §6.1's "advanced detail one tap away, not by default" principle. */
export function SourceCitations({ sources }: { sources: LessonSourceRef[] }) {
  if (sources.length === 0) {
    return <p className="text-sm text-[var(--color-text-faint)]">No sources linked yet.</p>;
  }
  return (
    <details className="disclosure">
      <summary className="text-sm">Sources ({sources.length})</summary>
      <ul className="mt-2 space-y-1 text-sm">
        {sources.map((s) => (
          <li key={s.id} className="text-[var(--color-text-muted)]">
            <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-[var(--color-accent)] break-all">
              {s.url}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>{" "}
            <span className="text-[var(--color-text-faint)]">
              ({s.type}, credibility {s.credibilityScore.toFixed(2)})
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
