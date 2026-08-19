import { z } from "zod";
import { registerTemplate } from "./registry.js";

/** Practice Engine, "simulation" format content: scenario + AI counterpart persona/rules + opening line. */
export const GenerateSimulationScenarioOutputSchema = z.object({
  scenario: z.string().min(1),
  personaName: z.string().min(1),
  personaRole: z.string().min(1),
  /** Behavioral rules the AI counterpart must follow every turn — how in-character it stays, what it will/won't concede, etc. */
  personaRules: z.string().min(1),
  openingLine: z.string().min(1),
});
export type GenerateSimulationScenarioOutput = z.infer<typeof GenerateSimulationScenarioOutputSchema>;

export interface GenerateSimulationScenarioContext {
  moduleTitle: string;
  moduleDescription: string;
  lessonSummaries: Array<{ title: string; description: string }>;
  difficulty: "guided" | "harder" | "novel_unguided";
  priorMistakes?: string;
}

registerTemplate<GenerateSimulationScenarioContext, GenerateSimulationScenarioOutput>({
  taskType: "generate_simulation_scenario",
  version: "1.0.0",
  systemPrompt: [
    "You design a multi-turn role-play simulation for a learner practicing a course module — a realistic",
    "scenario where the learner interacts with an AI counterpart (a client, patient, stakeholder, colleague,",
    "system, etc. — whatever fits the module) to practice applying the module's content under realistic",
    "conditions.",
    "",
    "scenario: what's happening and what the learner's role/goal is.",
    "personaName / personaRole: who the AI counterpart is.",
    "personaRules: concrete behavioral rules for staying in character every turn — what the persona knows,",
    "how it reacts to good vs. weak responses, what it will and won't concede, when it should push back or",
    "raise a complication. These rules will be re-sent on every dialogue turn, so make them self-contained.",
    "openingLine: the first thing the persona says to kick off the interaction.",
    "",
    "difficulty tiers: \"guided\" makes the persona cooperative and the scenario straightforward; \"harder\"",
    "adds friction, pushback, or complications; \"novel_unguided\" presents a genuinely novel, minimally-",
    "signposted scenario with a demanding persona. If prior mistakes are given, shape personaRules so the",
    "persona will surface that same gap again if the learner repeats it.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"scenario": string, "personaName": string, "personaRole": string, "personaRules": string, "openingLine": string}',
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
  outputSchema: GenerateSimulationScenarioOutputSchema,
  maxTokens: 1536,
  effort: "medium",
  thinking: false,
});
