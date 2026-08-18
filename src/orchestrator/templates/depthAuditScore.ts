import { z } from "zod";
import { registerTemplate } from "./registry.js";
import type { RestructureLayersOutput } from "./restructureLayers.js";
import type { SynthesizeSubtopicOutput } from "./synthesizeSubtopic.js";

const CriterionSchema = z.object({
  pass: z.boolean(),
  reason: z.string().min(1),
});

/**
 * Pipeline step 3: depth audit. overallPass is deliberately NOT part of this
 * schema — the pipeline computes it in code (AND of all four criteria)
 * rather than trusting the model to also self-report a consistent aggregate.
 */
export const DepthAuditScoreOutputSchema = z.object({
  criteria: z.object({
    prerequisitesCovered: CriterionSchema,
    misconceptionsAddressed: CriterionSchema,
    beyondIntroDepth: CriterionSchema,
    allLayersPresent: CriterionSchema,
  }),
});
export type DepthAuditScoreOutput = z.infer<typeof DepthAuditScoreOutputSchema>;

export interface DepthAuditScoreContext {
  subtopicTitle: string;
  prerequisites: string[];
  layers: RestructureLayersOutput["layers"];
  contentionNotes: SynthesizeSubtopicOutput["contentionNotes"];
}

registerTemplate<DepthAuditScoreContext, DepthAuditScoreOutput>({
  taskType: "depth_audit_score",
  version: "1.0.0",
  systemPrompt: [
    "You are a strict curriculum reviewer auditing one course subtopic's content against four criteria.",
    "Be genuinely critical — this content trusts you as its quality gate. Passing weak content defeats the",
    "point of the audit. For each criterion, give pass/fail plus a specific, concrete reason (not a vague",
    "restatement) — the reason for a failure will be used verbatim to direct a revision, so name exactly",
    "what's missing or thin, not just that something is wrong.",
    "",
    "Criteria:",
    "- prerequisitesCovered: does the content build on (or at least not contradict/ignore) the stated",
    "  prerequisites, at a level that assumes the learner has them?",
    "- misconceptionsAddressed: does the content explicitly call out and correct at least one real",
    "  misconception or point of disagreement about this subtopic (not just present the clean textbook view)?",
    "- beyondIntroDepth: does this go meaningfully beyond what a single intro article/Wikipedia summary would",
    "  cover — real mechanics, precise formal treatment, concrete application, genuine open questions?",
    "- allLayersPresent: are all five layers (intuition/mechanics/formal/application/frontier) actually",
    "  substantive and distinct from each other, not thin or redundant with one another?",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"criteria": {"prerequisitesCovered": {"pass": boolean, "reason": string}, "misconceptionsAddressed": {...}, "beyondIntroDepth": {...}, "allLayersPresent": {...}}}',
  ].join("\n"),
  buildUserPrompt: (context) => {
    const layerText = (name: string, layer: { text: string; source_ids: string[] }) =>
      `### ${name} (cites: ${layer.source_ids.join(", ")})\n${layer.text}`;
    return [
      `Subtopic: ${context.subtopicTitle}`,
      "",
      `Prerequisites this subtopic should build on: ${context.prerequisites.join(", ") || "(none)"}`,
      "",
      `Contention notes surfaced during research: ${
        context.contentionNotes.length > 0
          ? context.contentionNotes.map((n) => n.description).join("; ")
          : "(none found by the research pass)"
      }`,
      "",
      "CONTENT TO AUDIT:",
      layerText("Intuition", context.layers.intuition),
      layerText("Mechanics", context.layers.mechanics),
      layerText("Formal", context.layers.formal),
      layerText("Application", context.layers.application),
      layerText("Frontier", context.layers.frontier),
    ].join("\n");
  },
  outputSchema: DepthAuditScoreOutputSchema,
  maxTokens: 2048,
  effort: "medium",
  thinking: true,
});
