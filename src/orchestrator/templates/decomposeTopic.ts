import { z } from "zod";
import { registerTemplate } from "./registry.js";

/** Pipeline step 1: topic -> { prerequisites[], subtopics[] }. */
export const DecomposeTopicOutputSchema = z.object({
  prerequisites: z.array(z.string().min(1)),
  subtopics: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().min(1),
      })
    )
    .min(1),
});
export type DecomposeTopicOutput = z.infer<typeof DecomposeTopicOutputSchema>;

export interface DecomposeTopicContext {
  topic: string;
  diagnosticAnswers?: string[];
}

registerTemplate<DecomposeTopicContext, DecomposeTopicOutput>({
  taskType: "decompose_topic",
  version: "1.0.0",
  systemPrompt: [
    "You are a curriculum designer breaking a learning topic into prerequisites and subtopics.",
    "",
    "Prerequisites are things a learner should already know before starting — not part of the course itself.",
    "Subtopics are the distinct pieces of the topic itself, each substantial enough to need its own deep-dive",
    "(multiple search passes, a full explanation with intuition/mechanics/formal/application/frontier layers).",
    "Don't split so finely that subtopics are trivial, and don't leave them so broad that one subtopic is really several.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"prerequisites": string[], "subtopics": [{"title": string, "description": string}]}',
    '"description" is 1-2 sentences on what that subtopic covers and why it matters to the overall topic.',
  ].join("\n"),
  buildUserPrompt: (context) => {
    const lines = [`Decompose this topic into prerequisites and subtopics: "${context.topic}"`];
    if (context.diagnosticAnswers && context.diagnosticAnswers.length > 0) {
      lines.push(
        "",
        "The learner answered some diagnostic questions — use these to calibrate depth and starting point:",
        ...context.diagnosticAnswers.map((a, i) => `${i + 1}. ${a}`)
      );
    }
    return lines.join("\n");
  },
  outputSchema: DecomposeTopicOutputSchema,
  maxTokens: 2048,
  effort: "medium",
  thinking: true,
});
