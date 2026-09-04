export type MasteryStatus = "not_started" | "in_progress" | "mastered";

/** Threshold reused from the Quiz Engine's own weak-concept default (src/quizEngine/index.ts) — a knowledge_score at/above this reads as "mastered" here too, for a consistent meaning of the word across the app. */
const MASTERED_THRESHOLD = 0.75;

export function masteryStatusFor(knowledgeScore: number | null): MasteryStatus {
  if (knowledgeScore === null) return "not_started";
  if (knowledgeScore >= MASTERED_THRESHOLD) return "mastered";
  return "in_progress";
}

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

/** A simple state indicator — not started / in progress / mastered — deliberately NOT a mind map node (Phase 8). */
export function MasteryBadge({ knowledgeScore }: { knowledgeScore: number | null }) {
  const status = masteryStatusFor(knowledgeScore);
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${COLOR[status]}`}>{LABEL[status]}</span>
  );
}
