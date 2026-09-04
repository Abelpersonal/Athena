export type MasteryStatus = "not_started" | "in_progress" | "mastered";

/** Threshold reused from the Quiz Engine's own weak-concept default (src/quizEngine/index.ts) — a knowledge_score at/above this reads as "mastered" everywhere in the UI, for one consistent meaning of the word across the app (components/MasteryBadge.tsx, components/CourseMindMap.tsx). */
export const MASTERED_THRESHOLD = 0.75;

export function masteryStatusFor(knowledgeScore: number | null): MasteryStatus {
  if (knowledgeScore === null) return "not_started";
  if (knowledgeScore >= MASTERED_THRESHOLD) return "mastered";
  return "in_progress";
}
