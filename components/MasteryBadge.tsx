/**
 * Phase 8: masteryStatusFor()/MasteryStatus/MASTERED_THRESHOLD moved to src/shared/mastery.ts so
 * src/mindMap/layout.ts (a pure, backend-testable function — no JSX/CSS, unlike this component)
 * can reuse the SAME thresholds `CourseMindMap`'s graph nodes are colored by, rather than a
 * second copy that could drift. Re-exported here unchanged so every existing import of these from
 * "./MasteryBadge.js" keeps working.
 */
export { masteryStatusFor, type MasteryStatus, MASTERED_THRESHOLD } from "../src/shared/mastery.js";
import { masteryStatusFor, type MasteryStatus } from "../src/shared/mastery.js";

const LABEL: Record<MasteryStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  mastered: "Mastered",
};

const COLOR: Record<MasteryStatus, string> = {
  not_started: "text-[var(--color-text-faint)] border-[var(--color-border)]",
  in_progress: "text-[var(--color-warn)] border-[var(--color-warn)]/40",
  mastered: "text-[var(--color-accent)] border-[var(--color-accent)]/40",
};

/** A simple state indicator — not started / in progress / mastered. Also what the Phase 8 mind map's node colors are keyed by (src/mindMap/layout.ts), so the two views of the same course never disagree about what "mastered" means. */
export function MasteryBadge({ knowledgeScore }: { knowledgeScore: number | null }) {
  const status = masteryStatusFor(knowledgeScore);
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${COLOR[status]}`}>{LABEL[status]}</span>
  );
}
