import { z } from "zod";
import { registerTemplate } from "./registry.js";

/** Practice Engine step 5: a "what worked / what would you change" reflection prompt, tailored to this attempt's actual critique. */
export const GenerateReflectionPromptOutputSchema = z.object({
  reflectionPrompt: z.string().min(1),
});
export type GenerateReflectionPromptOutput = z.infer<typeof GenerateReflectionPromptOutputSchema>;

export interface GenerateReflectionPromptContext {
  moduleTitle: string;
  format: "project" | "simulation" | "debate";
  critique: string;
}

registerTemplate<GenerateReflectionPromptContext, GenerateReflectionPromptOutput>({
  taskType: "generate_reflection_prompt",
  version: "1.0.0",
  systemPrompt: [
    "You write a short, specific self-reflection prompt for a learner right after they received critique on a",
    "practice attempt. It should invite genuine 'what worked / what would you change' reflection, referencing",
    "the specific critique they just received (not a generic 'how did that go?' question) — 1-3 sentences.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"reflectionPrompt": string}',
  ].join("\n"),
  buildUserPrompt: (context) =>
    [
      `Module: ${context.moduleTitle}`,
      `Practice format: ${context.format}`,
      `Critique the learner just received: ${context.critique}`,
    ].join("\n"),
  outputSchema: GenerateReflectionPromptOutputSchema,
  maxTokens: 256,
  effort: "low",
  thinking: false,
});
