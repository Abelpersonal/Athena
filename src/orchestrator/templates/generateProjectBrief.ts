import { z } from "zod";
import { registerTemplate } from "./registry.js";

/** Practice Engine, "project" format content: a realistic hands-on task/dataset/prompt. */
export const GenerateProjectBriefOutputSchema = z.object({
  task: z.string().min(1),
  datasetOrPrompt: z.string().min(1),
  deliverableExpectations: z.string().min(1),
});
export type GenerateProjectBriefOutput = z.infer<typeof GenerateProjectBriefOutputSchema>;

export interface GenerateProjectBriefContext {
  moduleTitle: string;
  moduleDescription: string;
  lessonSummaries: Array<{ title: string; description: string }>;
  difficulty: "guided" | "harder" | "novel_unguided";
  /** The critique text from the learner's most recent prior attempt on this module, when difficulty > "guided" — the new brief should target these mistakes, not just be harder in general. */
  priorMistakes?: string;
}

registerTemplate<GenerateProjectBriefContext, GenerateProjectBriefOutput>({
  taskType: "generate_project_brief",
  version: "1.0.0",
  systemPrompt: [
    "You write a realistic hands-on project brief for a learner practicing a course module — something they",
    "actually DO and produce an artifact for, grounded in the module's real content (not a generic exercise).",
    "",
    "task: a clear, concrete description of what to build/produce/solve.",
    "datasetOrPrompt: the actual starting material — sample data, a starting prompt, a scenario spec, code",
    "skeleton description, etc. — concrete enough to start working immediately, not just a topic name.",
    "deliverableExpectations: what a finished submission should include so it can be evaluated afterward.",
    "",
    "difficulty tiers: \"guided\" gives significant structure/hints; \"harder\" removes some scaffolding and",
    "raises the bar; \"novel_unguided\" presents a genuinely novel task with minimal guidance, requiring real",
    "transfer of the module's skills to unfamiliar specifics. If prior mistakes are given, design the task so",
    "the learner is forced to confront that specific gap again, not just a harder version of the same easy",
    "parts.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"task": string, "datasetOrPrompt": string, "deliverableExpectations": string}',
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
  outputSchema: GenerateProjectBriefOutputSchema,
  maxTokens: 1536,
  effort: "medium",
  thinking: false,
});
