import { z } from "zod";
import { registerTemplate } from "./registry.js";

/**
 * Goal Planner (Phase 5) step 1: judge whether the user's raw input names a
 * narrow, single-course Topic or a broad, multi-course Goal. Never applied
 * silently — the CLI harness always confirms this with the user and lets
 * them override before proceeding (see src/harness/cli.ts's runGoalCommand).
 */
export const ClassifyTopicOrGoalOutputSchema = z.object({
  classification: z.enum(["topic", "goal"]),
  reasoning: z.string().min(1),
});
export type ClassifyTopicOrGoalOutput = z.infer<typeof ClassifyTopicOrGoalOutputSchema>;

export interface ClassifyTopicOrGoalContext {
  input: string;
}

registerTemplate<ClassifyTopicOrGoalContext, ClassifyTopicOrGoalOutput>({
  taskType: "classify_topic_or_goal",
  version: "1.0.0",
  systemPrompt: [
    "You classify a learner's raw input as either a narrow \"topic\" or a broad \"goal\".",
    "",
    'topic: something coherent enough to become ONE course — even if substantial, it\'s a single subject',
    '(e.g. "Special Relativity", "SQL query optimization", "the French Revolution").',
    'goal: a broad outcome/identity that genuinely requires MULTIPLE, largely independent skill domains to',
    'reach — decomposing it into one course would either be superficial or absurdly large',
    '(e.g. "become a full-stack quant", "become financially independent", "learn to build and ship a startup").',
    "",
    "A topic can still be big and deep (e.g. \"General Relativity\") without being a goal — the test is whether",
    "it's fundamentally ONE subject taught in sequence, or a bundle of genuinely separate subjects/domains a",
    "person would study somewhat independently (math, programming, finance, etc.) to reach an outcome.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"classification": "topic" | "goal", "reasoning": string}',
    '"reasoning" is 1-2 sentences a non-technical user could read to understand and second-guess your call.',
  ].join("\n"),
  buildUserPrompt: (context) => `Classify this input: "${context.input}"`,
  outputSchema: ClassifyTopicOrGoalOutputSchema,
  maxTokens: 512,
  effort: "medium",
  thinking: false,
});
