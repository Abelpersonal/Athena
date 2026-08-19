import { z } from "zod";
import { registerTemplate } from "./registry.js";

/**
 * Practice Engine multi-turn step: one dialogue turn, shared by both the
 * "simulation" and "debate" formats — both are "respond in character, adapt
 * to the user's input" (the PRD's step 2 wording is generic, not
 * format-specific), so one template drives both rather than duplicating a
 * near-identical prompt per format.
 */
export const DialogueTurnOutputSchema = z.object({
  reply: z.string().min(1),
});
export type DialogueTurnOutput = z.infer<typeof DialogueTurnOutputSchema>;

export interface DialogueTurnHistoryEntry {
  speaker: "user" | "ai";
  text: string;
}

export interface DialogueTurnContext {
  /** e.g. "You are Priya, a skeptical product manager..." — the persona/opponent identity + rules, self-contained since it's re-sent every turn. */
  personaInstructions: string;
  /** The scenario or claim this dialogue is grounded in. */
  situation: string;
  history: DialogueTurnHistoryEntry[];
  userInput: string;
}

registerTemplate<DialogueTurnContext, DialogueTurnOutput>({
  taskType: "dialogue_turn",
  version: "1.0.0",
  systemPrompt: [
    "You are playing a persona in an ongoing practice dialogue with a learner (a simulation counterpart or a",
    "debate opponent). Stay strictly in character per the persona instructions given to you, and respond",
    "specifically to what the learner just said — adapt to their actual input, don't recite a generic script.",
    "Keep replies focused and conversational (a few sentences to a short paragraph), not an essay.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"reply": string}',
  ].join("\n"),
  buildUserPrompt: (context) => {
    const lines = [
      `PERSONA INSTRUCTIONS: ${context.personaInstructions}`,
      `SITUATION: ${context.situation}`,
      "",
      "CONVERSATION SO FAR:",
    ];
    for (const turn of context.history) {
      lines.push(`${turn.speaker === "user" ? "Learner" : "You"}: ${turn.text}`);
    }
    lines.push(`Learner: ${context.userInput}`, "", "Respond in character as your next turn.");
    return lines.join("\n");
  },
  outputSchema: DialogueTurnOutputSchema,
  maxTokens: 768,
  effort: "medium",
  thinking: false,
});
