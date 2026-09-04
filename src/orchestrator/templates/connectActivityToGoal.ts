import { z } from "zod";
import { registerTemplate } from "./registry.js";

/**
 * Motivation/Engagement Layer (Phase 9), Deliverable 2's "ties back to stated goals" piece: one
 * short, honest sentence connecting the learner's most recent real activity to something they
 * themselves said they were working toward (UserProfile.statedGoals — see src/db/schema.ts).
 * Shown "occasional[ly]" per §5.12b, gated by shouldShowGoalConnection (src/motivation/pure.ts),
 * not on every Dashboard load. Same tone discipline as generate_next_topic_suggestions: no
 * artificial urgency, no dark patterns — a quiet, specific observation, not a retention hook.
 */
export const ConnectActivityToGoalOutputSchema = z.object({
  message: z.string().min(1),
});
export type ConnectActivityToGoalOutput = z.infer<typeof ConnectActivityToGoalOutputSchema>;

export interface ConnectActivityToGoalContext {
  courseTopic: string;
  statedGoals: string[];
}

registerTemplate<ConnectActivityToGoalContext, ConnectActivityToGoalOutput>({
  taskType: "connect_activity_to_goal",
  version: "1.0.0",
  systemPrompt: [
    "The learner recently studied a specific course. Write ONE short, warm sentence (two at the",
    "absolute most) connecting that recent activity back to one of the learner's OWN stated goals",
    "below — genuinely and specifically, referencing what they actually said where it reads",
    "naturally, not a generic platitude that could apply to anyone.",
    "",
    'Never invent urgency, streaks, or pressure language ("don\'t stop now", "keep it up or you\'ll',
    'fall behind", "you\'re on a roll, don\'t break it"). This is a quiet, encouraging observation —',
    "write like a mentor noticing genuine progress, never like a notification trying to pull someone",
    "back in.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"message": string}',
  ].join("\n"),
  buildUserPrompt: (context) =>
    [
      `Recently studied: "${context.courseTopic}"`,
      `The learner's own stated goals: ${context.statedGoals.map((g) => `"${g}"`).join(", ")}`,
    ].join("\n"),
  outputSchema: ConnectActivityToGoalOutputSchema,
  maxTokens: 512,
  effort: "low",
  thinking: false,
});
