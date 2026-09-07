import type { LessonSourceRef } from "../src/db/queries.js";
import type { Locator } from "../src/shared/locator.js";

function formatLocator(locator: Locator): string {
  return locator.type === "page" ? `page ${locator.value}` : locator.value;
}

/** Source citations, shown on demand (a <details> disclosure) — per §6.1's "advanced detail one tap away, not by default" principle. */
export function SourceCitations({ sources }: { sources: LessonSourceRef[] }) {
  if (sources.length === 0) {
    return <p className="text-sm text-[var(--color-text-faint)]">No sources linked yet.</p>;
  }
  return (
    <details className="disclosure">
      <summary className="text-sm">Sources ({sources.length})</summary>
      <ul className="mt-2 space-y-1 text-sm">
        {/* key includes the locator, not just s.id — the same source can legitimately appear more
            than once here (a distinct page/timestamp cited by a different key point each time). */}
        {sources.map((s, i) => (
          <li key={`${s.id}-${s.locator?.type ?? "none"}-${s.locator?.value ?? i}`} className="text-[var(--color-text-muted)]">
            <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-[var(--color-accent)] break-all">
              {s.url}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>{" "}
            <span className="text-[var(--color-text-faint)]">
              ({s.type}
              {s.locator ? `, ${formatLocator(s.locator)}` : ""}, credibility {s.credibilityScore.toFixed(2)})
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
