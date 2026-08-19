import { z } from "zod";
import { registerTemplate } from "./registry.js";

/**
 * Practice Engine step 3: critique the learner's actual output/performance.
 * This is explicitly a PRD quality bar, not just a schema check — the
 * critique must reference what the learner actually did in THIS attempt, not
 * a templated response (tests/practiceEngine.test.ts asserts this directly
 * by checking the critique quotes/references attempt-specific content).
 *
 * performanceScore (0-1, same continuous scale as the Quiz Engine's
 * knowledge_score) drives MasteryState.experienceScore — see practiceEngine/index.ts.
 */
export const CritiquePracticeAttemptOutputSchema = z.object({
  critique: z.string().min(1),
  performanceScore: z.number().min(0).max(1),
});
export type CritiquePracticeAttemptOutput = z.infer<typeof CritiquePracticeAttemptOutputSchema>;

export interface CritiquePracticeAttemptContext {
  moduleTitle: string;
  format: "project" | "simulation" | "debate";
  /** The task/scenario/claim the learner was given, so the critique can be judged against what was actually asked. */
  practiceBrief: string;
  /** What the learner actually produced — their project submission text, or the full dialogue transcript for simulation/debate. */
  userOutput: string;
  attemptNumber: number;
}

registerTemplate<CritiquePracticeAttemptContext, CritiquePracticeAttemptOutput>({
  taskType: "critique_practice_attempt",
  version: "1.0.0",
  systemPrompt: [
    "You critique a learner's practice attempt. Your critique MUST be specific and reference what the",
    "learner actually wrote/did/argued in THIS attempt — quote or closely paraphrase specific parts of their",
    "output, name specific strengths and specific gaps or errors. A generic, templated critique that could",
    "apply to any attempt on any topic is a failure — every learner's attempt is different and the critique",
    "must show that you actually read it.",
    "",
    "Cover: what they got right (specifically), what was missing, wrong, or underdeveloped (specifically,",
    "tied to their actual words/choices), and one or two concrete, actionable improvements.",
    "",
    "performanceScore is a continuous 0-1 rating of how well this specific attempt met the task's demands —",
    "1.0 is a strong, complete performance; 0.0 is a missing or entirely off-target attempt.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"critique": string, "performanceScore": number}',
  ].join("\n"),
  buildUserPrompt: (context) =>
    [
      `Module: ${context.moduleTitle}`,
      `Practice format: ${context.format}`,
      `Attempt number: ${context.attemptNumber}`,
      "",
      `WHAT THE LEARNER WAS GIVEN:\n${context.practiceBrief}`,
      "",
      `WHAT THE LEARNER ACTUALLY PRODUCED:\n${context.userOutput || "(nothing was submitted)"}`,
    ].join("\n"),
  outputSchema: CritiquePracticeAttemptOutputSchema,
  maxTokens: 1536,
  effort: "high",
  thinking: true,
});
