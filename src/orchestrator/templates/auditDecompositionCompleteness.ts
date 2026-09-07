import { z } from "zod";
import { registerTemplate } from "./registry.js";

const SubtopicRefSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
});

/**
 * A new, separate audit ABOVE the existing per-subtopic depth audit (depthAuditScore.ts) — that
 * one only ever asks "is THIS subtopic's content deep enough?" and has no way to notice a
 * subtopic that was never proposed in the first place. This one runs once, right after
 * decompose_topic and before any per-subtopic research begins, and asks the opposite question:
 * for a course on this topic, is the PROPOSED LIST of subtopics itself complete? Never modifies,
 * absorbs, or duplicates the depth audit's own scope — see `research/pipeline.ts`.
 */
export const AuditDecompositionCompletenessOutputSchema = z.object({
  complete: z.boolean(),
  /** A short, human-readable verdict summary — logged via onProgress, not itself the mechanism for naming gaps (missingSubtopics is). */
  assessment: z.string().min(1),
  /**
   * Empty when complete. Real, specific subtopics (same {title, description} shape decompose_topic
   * itself produces) a competent curriculum designer would have included — mirrors the depth
   * audit's own "name the specific failing criteria, not just try again" principle: never a vague
   * "this seems incomplete," always something concrete enough to append directly to the working
   * subtopic list.
   */
  missingSubtopics: z.array(SubtopicRefSchema),
});
export type AuditDecompositionCompletenessOutput = z.infer<typeof AuditDecompositionCompletenessOutputSchema>;

export interface AuditDecompositionCompletenessContext {
  topic: string;
  prerequisites: string[];
  subtopics: Array<{ title: string; description: string }>;
  /**
   * Phase 5's additive goal/domain framing. A goal-biased decomposition deliberately emphasizes
   * some angles over others for that goal (decompose_topic's own documented behavior) — this
   * context is what keeps that intentional emphasis from being flagged as a false gap here, while
   * genuine fundamentals must still be complete either way. Absent for every standalone (non-goal)
   * call, exactly like decompose_topic's own goalContext.
   */
  goalContext?: string;
}

registerTemplate<AuditDecompositionCompletenessContext, AuditDecompositionCompletenessOutput>({
  taskType: "audit_decomposition_completeness",
  version: "1.0.0",
  systemPrompt: [
    "You are a strict curriculum reviewer auditing whether a PROPOSED LIST OF SUBTOPICS for a course is",
    "actually complete — NOT whether any one subtopic is deep enough (a separate, later audit already checks",
    "that once each subtopic has real content). Your only question here: does this list, taken as a whole,",
    "leave out a whole sub-area a competent teacher or curriculum designer would have included?",
    "",
    "Look specifically for: missing foundational pieces, missing major branches or applications, or a listed",
    "subtopic that's actually hiding two distinct topics inside one entry (which would mean the second one is",
    "effectively missing).",
    "",
    "If goal context is given below, the list may deliberately emphasize some angles over others for that",
    "goal — that is intentional bias, not a gap. Only flag a TRUE omission: something a learner would",
    "genuinely need to understand the topic that isn't covered by any existing subtopic, even implicitly.",
    "",
    "Be genuinely critical, but don't invent a missing subtopic just to have something to report — if the",
    "list is genuinely complete, say so plainly. When you DO report one, give it a real title and a 1-2",
    "sentence description in the same shape as a real subtopic, never a vague description of what's missing.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"complete": boolean, "assessment": string, "missingSubtopics": [{"title": string, "description": string}]}',
  ].join("\n"),
  buildUserPrompt: (context) => {
    const lines = [
      `Topic: ${context.topic}`,
      `Prerequisites (already assumed known — NOT part of this course, don't flag these as missing): ${
        context.prerequisites.join(", ") || "(none)"
      }`,
      "",
      "Proposed subtopics:",
      ...context.subtopics.map((s, i) => `${i + 1}. ${s.title} — ${s.description}`),
    ];
    if (context.goalContext) {
      lines.push("", `Goal context (deliberate emphasis for this framing, not itself a gap): ${context.goalContext}`);
    }
    return lines.join("\n");
  },
  outputSchema: AuditDecompositionCompletenessOutputSchema,
  maxTokens: 1536,
  effort: "medium",
  thinking: true,
});
