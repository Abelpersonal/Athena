import { z } from "zod";
import { registerTemplate } from "./registry.js";

/** Pipeline step 2d: extract grounded key points from cleaned source text, each tagged with its source_id. */
export const ExtractGroundedKeyPointsOutputSchema = z.object({
  keyPoints: z
    .array(
      z.object({
        point: z.string().min(1),
        source_id: z.string().min(1),
      })
    )
    .min(1),
});
export type ExtractGroundedKeyPointsOutput = z.infer<typeof ExtractGroundedKeyPointsOutputSchema>;

export interface SourceExcerpt {
  source_id: string;
  url: string;
  title: string;
  text: string;
}

export interface ExtractGroundedKeyPointsContext {
  subtopicTitle: string;
  sources: SourceExcerpt[];
  gapInstruction?: string;
}

function formatSources(sources: SourceExcerpt[]): string {
  return sources
    .map(
      (s) =>
        `--- source_id: ${s.source_id} | title: ${s.title} | url: ${s.url} ---\n${s.text}`
    )
    .join("\n\n");
}

registerTemplate<ExtractGroundedKeyPointsContext, ExtractGroundedKeyPointsOutput>({
  taskType: "extract_grounded_key_points",
  version: "1.0.0",
  systemPrompt: [
    "You extract key points from source material for a course subtopic. Every key point you output MUST be",
    "traceable to exactly one of the sources given to you, and you MUST tag it with that source's source_id.",
    "",
    "CRITICAL: only use the exact source_id values given to you below. Never invent a source_id. If a point",
    "is supported by more than one source, pick the single best-supporting source_id for it — do not invent",
    "a combined ID.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"keyPoints": [{"point": string, "source_id": string}]}',
  ].join("\n"),
  buildUserPrompt: (context) => {
    const lines = [
      `Subtopic: ${context.subtopicTitle}`,
      "",
      "Valid source_id values (use ONLY these — do not invent others):",
      context.sources.map((s) => s.source_id).join(", "),
      "",
      "SOURCES:",
      formatSources(context.sources),
    ];
    if (context.gapInstruction) {
      lines.push(
        "",
        `The previous pass on this subtopic was too shallow: ${context.gapInstruction}`,
        "Prioritize extracting points that close that gap, where the sources support it."
      );
    }
    return lines.join("\n");
  },
  outputSchema: ExtractGroundedKeyPointsOutputSchema,
  maxTokens: 2048,
  effort: "medium",
  thinking: false,
});
