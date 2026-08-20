import { z } from "zod";
import { registerTemplate } from "./registry.js";

/**
 * Overlap detection (Phase 5, src/pathPlanner/overlap.ts): a LIGHTWEIGHT,
 * targeted staleness check for a topic that's mastered but past its
 * volatility-tier recheck window — explicitly NOT a full re-research pass,
 * just a quick judgment call on whether the existing course is still likely
 * accurate given how much time has passed and how fast this kind of topic
 * tends to change.
 */
export const QuickRefreshCheckOutputSchema = z.object({
  stillAccurate: z.boolean(),
  reason: z.string().min(1),
});
export type QuickRefreshCheckOutput = z.infer<typeof QuickRefreshCheckOutputSchema>;

export interface QuickRefreshCheckContext {
  topicName: string;
  volatilityTier: "fast" | "medium" | "slow" | "mixed";
  daysSinceLastVerified: number;
  existingLessonTitles: string[];
}

registerTemplate<QuickRefreshCheckContext, QuickRefreshCheckOutput>({
  taskType: "quick_refresh_check",
  version: "1.0.0",
  systemPrompt: [
    "You do a QUICK, lightweight staleness check on an already-mastered course topic — not a full",
    "re-research pass. Given the topic, how long it's been since it was last verified, its volatility tier",
    "(how fast this KIND of topic typically changes), and the existing lesson titles it currently covers,",
    "judge whether the content is still likely accurate as-is, or whether real gaps have probably opened up.",
    "",
    "Default toward stillAccurate: true unless there's a concrete, specific reason to doubt it (e.g. a",
    "fast-moving topic with a long gap, or lesson titles that name something with an obvious update",
    "cadence like current events, current tooling versions, or current regulations). Being newly re-verified",
    "should be the exception that triggers full regeneration, not the default — this check exists specifically",
    "to avoid unnecessary re-research.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"stillAccurate": boolean, "reason": string}',
  ].join("\n"),
  buildUserPrompt: (context) =>
    [
      `Topic: ${context.topicName}`,
      `Volatility tier: ${context.volatilityTier}`,
      `Days since last verified: ${context.daysSinceLastVerified}`,
      "Existing lesson titles:",
      ...context.existingLessonTitles.map((t) => `- ${t}`),
    ].join("\n"),
  outputSchema: QuickRefreshCheckOutputSchema,
  maxTokens: 512,
  effort: "low",
  thinking: false,
});
