import { z } from "zod";
import { registerTemplate } from "./registry.js";
import type { SynthesizeSubtopicOutput } from "./synthesizeSubtopic.js";

const DepthLayerSchema = z.object({
  text: z.string().min(30),
  source_ids: z.array(z.string().min(1)).min(1),
});

/** Pipeline step 2h: restructure the cited synthesis into the five depth layers. */
export const RestructureLayersOutputSchema = z.object({
  layers: z.object({
    intuition: DepthLayerSchema,
    mechanics: DepthLayerSchema,
    formal: DepthLayerSchema,
    application: DepthLayerSchema,
    frontier: DepthLayerSchema,
  }),
});
export type RestructureLayersOutput = z.infer<typeof RestructureLayersOutputSchema>;

export interface RestructureLayersContext {
  subtopicTitle: string;
  synthesis: SynthesizeSubtopicOutput;
  validSourceIds: string[];
  gapInstruction?: string;
}

registerTemplate<RestructureLayersContext, RestructureLayersOutput>({
  taskType: "restructure_layers",
  version: "1.0.0",
  systemPrompt: [
    "You restructure a cited synthesis of a course subtopic into five depth layers, each written for a",
    "different point in the learner's understanding. Every layer must be genuinely written, not a placeholder",
    "or a one-line restatement of the layer above it — each should meaningfully add depth.",
    "",
    "The five layers, in order of increasing depth:",
    "- intuition: the core idea in plain language — what it is and why it matters, no jargon, an analogy if useful.",
    "- mechanics: how it actually works, step by step — the real process/structure, not just the gist.",
    "- formal: precise definitions, the underlying model/theory/rules, stated rigorously.",
    "- application: how this shows up in real, concrete use — worked examples, when you'd reach for this.",
    "- frontier: open questions, edge cases, where experts disagree, what's actively evolving or debated.",
    "",
    "Every layer MUST cite at least one source_id from the valid list given to you — never invent a source_id.",
    "Carry forward the synthesis's contentionNotes into wherever they fit best (usually application or frontier).",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"layers": {"intuition": {"text": string, "source_ids": string[]}, "mechanics": {...}, "formal": {...}, "application": {...}, "frontier": {...}}}',
  ].join("\n"),
  buildUserPrompt: (context) => {
    const lines = [
      `Subtopic: ${context.subtopicTitle}`,
      "",
      "Valid source_id values (use ONLY these — do not invent others):",
      context.validSourceIds.join(", "),
      "",
      "SYNTHESIZED CLAIMS:",
      context.synthesis.claims
        .map((c) => `- [${c.source_ids.join(",")}]${c.addressesContention ? " (addresses contention)" : ""} ${c.text}`)
        .join("\n"),
      "",
      "CONTENTION NOTES (make sure these are represented in the layers, not dropped):",
      context.synthesis.contentionNotes
        .map((n) => `- [${n.source_ids.join(",")}] ${n.description} -> ${n.resolution}`)
        .join("\n") || "(none)",
    ];
    if (context.gapInstruction) {
      lines.push(
        "",
        `The previous pass on this subtopic was too shallow: ${context.gapInstruction}`,
        "Make sure the relevant layer(s) specifically close that gap, with real substance rather than a longer restatement."
      );
    }
    return lines.join("\n");
  },
  outputSchema: RestructureLayersOutputSchema,
  maxTokens: 4096,
  effort: "medium",
  thinking: true,
});
