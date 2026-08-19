import { z } from "zod";
import { registerTemplate } from "./registry.js";

/**
 * Practice Engine step 0. The PRD's Practice Engine spec takes topic_type as
 * an input "set by the Research Agent," but Phase 2's Research Agent (as
 * built) doesn't classify this — rather than reaching back into an
 * already-verified earlier phase for a field only Phase 4 uses, the Practice
 * Engine classifies it itself as its own first step. See README for the full
 * deviation note.
 */
export const ClassifyTopicTypeOutputSchema = z.object({
  topicType: z.enum(["conceptual", "skill_based"]),
  justification: z.string().min(1),
});
export type ClassifyTopicTypeOutput = z.infer<typeof ClassifyTopicTypeOutputSchema>;

export interface ClassifyTopicTypeContext {
  moduleTitle: string;
  moduleDescription: string;
  lessonSummaries: Array<{ title: string; description: string }>;
}

registerTemplate<ClassifyTopicTypeContext, ClassifyTopicTypeOutput>({
  taskType: "classify_topic_type",
  version: "1.0.0",
  systemPrompt: [
    "You classify a course module as either \"conceptual\" or \"skill_based\" for the purpose of choosing how",
    "a learner should practice it.",
    "",
    "conceptual: the module is primarily about understanding ideas, theories, models, or relationships —",
    "mastery looks like being able to explain, argue about, or reason through the concept correctly.",
    "skill_based: the module is primarily about being able to DO something — apply a procedure, write code,",
    "perform a technique, or produce an artifact — mastery looks like successfully executing the skill.",
    "",
    "Many modules have some of both; classify by what mastery actually requires MOST — could a learner truly",
    "master this by only discussing it (conceptual), or do they need to actually practice doing it",
    "(skill_based)?",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"topicType": "conceptual" | "skill_based", "justification": string}',
  ].join("\n"),
  buildUserPrompt: (context) =>
    [
      `Module: ${context.moduleTitle}`,
      context.moduleDescription,
      "",
      "Lessons in this module:",
      ...context.lessonSummaries.map((l) => `- ${l.title}: ${l.description}`),
    ].join("\n"),
  outputSchema: ClassifyTopicTypeOutputSchema,
  maxTokens: 512,
  effort: "medium",
  thinking: false,
});
