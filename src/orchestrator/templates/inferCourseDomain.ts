import { z } from "zod";
import { registerTemplate } from "./registry.js";

/**
 * Continuous Learning Agent (Phase 6): a lightweight domain tag for a STANDALONE completed course
 * (one that wasn't generated from a Path, so it has no PathDomain to read — see
 * getRecentCourseDomains, src/continuousLearning/index.ts). Deliberately minimal — a short label,
 * not a taxonomy — since its only consumer is the diversity check (isDomainClusterNarrow), which
 * just needs a comparable string, not a precise classification.
 */
export const InferCourseDomainOutputSchema = z.object({
  domain: z.string().min(1),
});
export type InferCourseDomainOutput = z.infer<typeof InferCourseDomainOutputSchema>;

export interface InferCourseDomainContext {
  topic: string;
}

registerTemplate<InferCourseDomainContext, InferCourseDomainOutput>({
  taskType: "infer_course_domain",
  version: "1.0.0",
  systemPrompt: [
    "Tag a course topic with ONE short, broad domain label — the kind of coarse category you'd use",
    'to notice a learner\'s recent interests clustering (e.g. "Math", "Programming", "History",',
    '"Biology", "Finance", "Philosophy", "Physics"). Keep it short (1-3 words) and broad — this is a',
    "coarse grouping label, not a precise subject classification.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"domain": string}',
  ].join("\n"),
  buildUserPrompt: (context) => `Tag this course topic with a broad domain: "${context.topic}"`,
  outputSchema: InferCourseDomainOutputSchema,
  maxTokens: 256,
  effort: "low",
  thinking: false,
});
