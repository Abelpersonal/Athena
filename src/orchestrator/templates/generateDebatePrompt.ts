import { z } from "zod";
import { registerTemplate } from "./registry.js";

/** Practice Engine, "debate" format content: a contested claim + starting arguments + the learner's assigned position. */
export const GenerateDebatePromptOutputSchema = z.object({
  claim: z.string().min(1),
  userPosition: z.enum(["for", "against"]),
  /** The AI opponent's opening argument for the OPPOSITE side, kicking off the debate. */
  openingArgument: z.string().min(1),
  /** Behavioral rules for the AI opponent across turns — how it argues, when it concedes a good point, when it raises a new angle. */
  opponentRules: z.string().min(1),
});
export type GenerateDebatePromptOutput = z.infer<typeof GenerateDebatePromptOutputSchema>;

export interface GenerateDebatePromptContext {
  moduleTitle: string;
  moduleDescription: string;
  lessonSummaries: Array<{ title: string; description: string }>;
  difficulty: "guided" | "harder" | "novel_unguided";
  priorMistakes?: string;
}

registerTemplate<GenerateDebatePromptContext, GenerateDebatePromptOutput>({
  taskType: "generate_debate_prompt",
  version: "1.0.0",
  systemPrompt: [
    "You design a practice debate for a learner studying a course module — a genuinely contested claim",
    "connected to the module's content, where arguing well requires real understanding, not talking points.",
    "",
    "claim: a specific, debatable statement related to the module (not a settled fact — something reasonable",
    "people/experts actually disagree about, or a claim with real nuance/exceptions).",
    "userPosition: which side (\"for\" or \"against\") the learner will argue — pick whichever side makes for",
    "the more instructive practice given the module's content.",
    "openingArgument: the AI opponent's opening argument for the OTHER side, to kick off the exchange.",
    "opponentRules: concrete behavioral rules for the AI opponent across turns — how rigorously it argues,",
    "what it concedes when the learner makes a genuinely strong point (a real opponent shouldn't be",
    "unbeatable), what new angles or counterexamples it raises, when it should push back on a weak argument.",
    "These rules will be re-sent on every dialogue turn, so make them self-contained.",
    "",
    "difficulty tiers: \"guided\" makes the opponent's arguments straightforward to counter; \"harder\" raises",
    "genuinely tougher counterarguments; \"novel_unguided\" presents a harder, less obviously-signposted claim",
    "with a demanding opponent. If prior mistakes are given, shape opponentRules so the opponent will press on",
    "that same gap again if the learner repeats it.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"claim": string, "userPosition": "for" | "against", "openingArgument": string, "opponentRules": string}',
  ].join("\n"),
  buildUserPrompt: (context) => {
    const lines = [
      `Module: ${context.moduleTitle}`,
      context.moduleDescription,
      "",
      "Lessons in this module:",
      ...context.lessonSummaries.map((l) => `- ${l.title}: ${l.description}`),
      "",
      `Difficulty tier: ${context.difficulty}`,
    ];
    if (context.priorMistakes) {
      lines.push("", `Recurring mistake(s) from the learner's prior attempt to target: ${context.priorMistakes}`);
    }
    return lines.join("\n");
  },
  outputSchema: GenerateDebatePromptOutputSchema,
  maxTokens: 1536,
  effort: "medium",
  thinking: false,
});
