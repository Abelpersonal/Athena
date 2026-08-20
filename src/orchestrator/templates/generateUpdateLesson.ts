import { z } from "zod";
import { registerTemplate } from "./registry.js";

/**
 * Knowledge Update Agent (Phase 6) step 3, major-delta branch: a short, TARGETED "update lesson" —
 * delta only, not a re-teach. Stored as its own LessonUpdate record linked to the original Lesson
 * (see src/db/schema.ts's lessonUpdates table) — the original's five-layer content is never
 * rewritten or touched; this is an addendum, not a replacement.
 */
export const GenerateUpdateLessonOutputSchema = z.object({
  title: z.string().min(1),
  whatChanged: z.string().min(1),
  updatedGuidance: z.string().min(1),
});
export type GenerateUpdateLessonOutput = z.infer<typeof GenerateUpdateLessonOutputSchema>;

export interface GenerateUpdateLessonContext {
  lessonTitle: string;
  existingFactSummary: string;
  newFindingSummary: string;
  explanation: string;
}

registerTemplate<GenerateUpdateLessonContext, GenerateUpdateLessonOutput>({
  taskType: "generate_update_lesson",
  version: "1.0.0",
  systemPrompt: [
    "Write a SHORT, TARGETED update addendum for a lesson whose content has been superseded by a",
    "major change — NOT a full re-teach of the lesson, just the delta: what changed and what the",
    "learner should now believe/do instead. Assume the reader already took the original lesson.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"title": string, "whatChanged": string, "updatedGuidance": string}',
    '"title" is a short heading for this update (e.g. "Update: X is now Y"). "whatChanged" states',
    'the delta plainly — what was true before, what\'s true now. "updatedGuidance" is what the',
    "learner should actually do with this — the corrected takeaway.",
  ].join("\n"),
  buildUserPrompt: (context) =>
    [
      `Original lesson: "${context.lessonTitle}"`,
      `What the lesson previously said: ${context.existingFactSummary}`,
      `What's now found to be true: ${context.newFindingSummary}`,
      `Why this matters: ${context.explanation}`,
    ].join("\n"),
  outputSchema: GenerateUpdateLessonOutputSchema,
  maxTokens: 1024,
  effort: "medium",
  thinking: false,
});
