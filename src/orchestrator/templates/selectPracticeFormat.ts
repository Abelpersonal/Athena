import { z } from "zod";
import { registerTemplate } from "./registry.js";
import type { ClassifyTopicTypeOutput } from "./classifyTopicType.js";

/** Practice Engine step 1: choose project/simulation/debate given the module's topic_type. */
export const SelectPracticeFormatOutputSchema = z.object({
  format: z.enum(["project", "simulation", "debate"]),
  justification: z.string().min(1),
});
export type SelectPracticeFormatOutput = z.infer<typeof SelectPracticeFormatOutputSchema>;

export interface SelectPracticeFormatContext {
  moduleTitle: string;
  moduleDescription: string;
  topicType: ClassifyTopicTypeOutput["topicType"];
  /** attempt-number-driven, mirrored structurally by practiceEngine's own PracticeDifficulty type. */
  difficulty: "guided" | "harder" | "novel_unguided";
}

registerTemplate<SelectPracticeFormatContext, SelectPracticeFormatOutput>({
  taskType: "select_practice_format",
  version: "1.0.0",
  systemPrompt: [
    "You choose the best practice format for a course module, given its topic_type classification:",
    "",
    "- project: a realistic hands-on task/dataset/prompt the learner works through and submits a concrete",
    "  artifact for. Usually the best fit for skill_based modules — practicing DOING something.",
    "- simulation: a scenario with an AI counterpart persona the learner interacts with over multiple turns",
    "  (e.g. a client, a patient, a stakeholder, a system under test). Fits either topic_type when the skill",
    "  or concept is best exercised through realistic interaction/dialogue rather than a static task.",
    "- debate: a contested claim the learner argues for or against against an AI opponent. Usually the best",
    "  fit for conceptual modules — practicing reasoning and defending understanding under challenge.",
    "",
    "These are defaults, not rigid rules — pick whichever format would genuinely produce the most useful",
    "practice for THIS module's actual content, and justify your choice concretely.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"format": "project" | "simulation" | "debate", "justification": string}',
  ].join("\n"),
  buildUserPrompt: (context) =>
    [
      `Module: ${context.moduleTitle}`,
      context.moduleDescription,
      `topic_type: ${context.topicType}`,
      `difficulty tier for this attempt: ${context.difficulty}`,
    ].join("\n"),
  outputSchema: SelectPracticeFormatOutputSchema,
  maxTokens: 512,
  effort: "medium",
  thinking: false,
});
