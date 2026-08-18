import { z } from "zod";
import { registerTemplate } from "./registry.js";

/**
 * Second example task_type — proves the registry supports more than one
 * template and that each can have its own schema/shape. Also a throwaway proof.
 */
export const ExtractKeyPointsOutputSchema = z.object({
  keyPoints: z.array(z.string().min(1)).min(1),
});
export type ExtractKeyPointsOutput = z.infer<typeof ExtractKeyPointsOutputSchema>;

export interface ExtractKeyPointsContext {
  text: string;
  maxPoints?: number;
}

registerTemplate<ExtractKeyPointsContext, ExtractKeyPointsOutput>({
  taskType: "extract_key_points",
  version: "1.0.0",
  systemPrompt: [
    "You extract the key points from a piece of text.",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"keyPoints": string[]}',
    'Each entry in "keyPoints" is one distinct key point, stated as a short standalone sentence.',
  ].join("\n"),
  buildUserPrompt: (context) => {
    const maxPoints = context.maxPoints ?? 5;
    return `Extract at most ${maxPoints} key points from the following text.\n\nTEXT:\n${context.text}`;
  },
  outputSchema: ExtractKeyPointsOutputSchema,
  maxTokens: 1024,
  effort: "low",
  thinking: false,
});
