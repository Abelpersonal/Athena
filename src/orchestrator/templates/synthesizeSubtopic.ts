import { z } from "zod";
import { registerTemplate } from "./registry.js";
import type { ExtractGroundedKeyPointsOutput } from "./extractGroundedKeyPoints.js";
import type { SourceExcerpt } from "./extractGroundedKeyPoints.js";

/**
 * Pipeline step 2g: synthesize ALL notes for a subtopic into one unified,
 * cited explanation, resolving/explaining any contradictions found during
 * the contention-focused search pass.
 */
export const SynthesizeSubtopicOutputSchema = z.object({
  claims: z
    .array(
      z.object({
        text: z.string().min(1),
        source_ids: z.array(z.string().min(1)).min(1),
        addressesContention: z.boolean().default(false),
      })
    )
    .min(1),
  contentionNotes: z
    .array(
      z.object({
        description: z.string().min(1),
        resolution: z.string().min(1),
        source_ids: z.array(z.string().min(1)).min(1),
      })
    )
    .default([]),
});
export type SynthesizeSubtopicOutput = z.infer<typeof SynthesizeSubtopicOutputSchema>;

export interface SynthesizeSubtopicContext {
  subtopicTitle: string;
  groundedKeyPoints: ExtractGroundedKeyPointsOutput["keyPoints"];
  contentionMaterial: SourceExcerpt[];
  validSourceIds: string[];
  gapInstruction?: string;
  /** Phase 5: same additive goal/domain framing as decompose_topic's — biases which claims get emphasized/ordered toward, never a reason to drop or shallow a genuine fundamental. */
  goalContext?: string;
}

registerTemplate<SynthesizeSubtopicContext, SynthesizeSubtopicOutput>({
  taskType: "synthesize_subtopic",
  version: "1.0.0",
  systemPrompt: [
    "You synthesize research notes for one course subtopic into a single unified, well-organized explanation,",
    "represented as an ordered list of cited claims (not free prose) plus a list of any contradictions found.",
    "",
    "Rules:",
    "- Every claim MUST cite at least one source_id from the valid list given to you. Never invent a source_id.",
    "- Combine and de-duplicate overlapping points from different sources into single, clearer claims.",
    "- If sources disagree or the contention material surfaces a misconception, do NOT just drop it — add a",
    "  contentionNotes entry describing the disagreement/misconception and how you're resolving it for the",
    "  learner (which view is more accurate, in what conditions each applies, or that it's a genuine open",
    "  question). Mark any claim that specifically addresses a contention/misconception with",
    '  "addressesContention": true.',
    "- Order claims in a sensible teaching order (foundational ideas first), not source order.",
    "- If goal context is given below, let it bias which claims you emphasize/expand and how you frame their",
    "  relevance — but every fundamental claim needed to actually understand the subtopic still belongs here,",
    "  covered rigorously. Goal context changes emphasis, never depth or rigor.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"claims": [{"text": string, "source_ids": string[], "addressesContention": boolean}], "contentionNotes": [{"description": string, "resolution": string, "source_ids": string[]}]}',
  ].join("\n"),
  buildUserPrompt: (context) => {
    const lines = [
      `Subtopic: ${context.subtopicTitle}`,
      "",
      "Valid source_id values (use ONLY these — do not invent others):",
      context.validSourceIds.join(", "),
      "",
      "GROUNDED KEY POINTS FROM INITIAL RESEARCH:",
      context.groundedKeyPoints.map((kp) => `- [${kp.source_id}] ${kp.point}`).join("\n"),
      "",
      "RAW MATERIAL FROM CONTENTION-FOCUSED RESEARCH (misconceptions/disagreements/edge cases):",
      context.contentionMaterial
        .map((s) => `--- source_id: ${s.source_id} | title: ${s.title} | url: ${s.url} ---\n${s.text}`)
        .join("\n\n") || "(none found)",
    ];
    if (context.gapInstruction) {
      lines.push(
        "",
        `The previous pass on this subtopic was too shallow: ${context.gapInstruction}`,
        "Make sure this synthesis specifically closes that gap."
      );
    }
    if (context.goalContext) {
      lines.push("", `Goal context (bias emphasis, not rigor): ${context.goalContext}`);
    }
    return lines.join("\n");
  },
  outputSchema: SynthesizeSubtopicOutputSchema,
  maxTokens: 4096,
  effort: "medium",
  thinking: true,
});
