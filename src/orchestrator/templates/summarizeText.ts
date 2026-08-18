import { z } from "zod";
import { registerTemplate } from "./registry.js";

/**
 * Example task_type proving the Orchestrator pipeline end-to-end. Deliberately
 * simple and self-contained — not a real product feature.
 */
export const SummarizeTextOutputSchema = z.object({
  summary: z.string().min(1),
  wordCount: z.number().int().positive(),
});
export type SummarizeTextOutput = z.infer<typeof SummarizeTextOutputSchema>;

export interface SummarizeTextContext {
  text: string;
  maxWords?: number;
}

registerTemplate<SummarizeTextContext, SummarizeTextOutput>({
  taskType: "summarize_text",
  version: "1.0.0",
  systemPrompt: [
    "You summarize text concisely and accurately, preserving the key meaning.",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"summary": string, "wordCount": number}',
    '"summary" is your summary text. "wordCount" is the word count of your summary.',
  ].join("\n"),
  buildUserPrompt: (context) => {
    const maxWords = context.maxWords ?? 100;
    return `Summarize the following text in at most ${maxWords} words.\n\nTEXT:\n${context.text}`;
  },
  outputSchema: SummarizeTextOutputSchema,
  maxTokens: 1024,
  effort: "low",
  thinking: false,
});
