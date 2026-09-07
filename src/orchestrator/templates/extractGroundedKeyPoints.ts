import { z } from "zod";
import { registerTemplate } from "./registry.js";
import type { Locator } from "../../shared/locator.js";

/** Matches `src/shared/locator.ts`'s `Locator` type exactly — that file, not this schema, is the source of truth for the shape; kept in sync by hand since Zod schemas and plain types can't share a single definition. */
const LocatorSchema = z.union([
  z.object({ type: z.literal("page"), value: z.number() }),
  z.object({ type: z.literal("timestamp"), value: z.string() }),
]) satisfies z.ZodType<Locator>;

/**
 * Pipeline step 2d: extract grounded key points from cleaned source text, each tagged with its
 * source_id. `locator` is optional, additive metadata (a PDF page / video timestamp) on top of
 * that citation — it is never a substitute for source_id and is never validated as a grounding
 * gate (see `src/research/grounding.ts`'s `checkLocatorSanity`, a soft, warn-only check).
 */
export const ExtractGroundedKeyPointsOutputSchema = z.object({
  keyPoints: z
    .array(
      z.object({
        point: z.string().min(1),
        source_id: z.string().min(1),
        locator: LocatorSchema.optional(),
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
  /** Present when this excerpt is one chunk (a page/timestamp segment) of a larger PDF/video source — tells the model what locator to cite if it uses this excerpt. */
  locator?: Locator;
}

export interface ExtractGroundedKeyPointsContext {
  subtopicTitle: string;
  sources: SourceExcerpt[];
  gapInstruction?: string;
}

function formatLocator(locator: Locator): string {
  return locator.type === "page" ? `page: ${locator.value}` : `timestamp: ${locator.value}`;
}

function formatSources(sources: SourceExcerpt[]): string {
  return sources
    .map((s) => {
      const locatorTag = s.locator ? ` | ${formatLocator(s.locator)}` : "";
      return `--- source_id: ${s.source_id} | title: ${s.title} | url: ${s.url}${locatorTag} ---\n${s.text}`;
    })
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
    "Some excerpts are tagged with a locator (a page number or a video timestamp) in their header line.",
    "When the excerpt you drew a point from has one, include that exact locator on the key point:",
    '{"type": "page", "value": <number>} or {"type": "timestamp", "value": "<string, e.g. 4:32>"}.',
    "Copy the locator's type and value verbatim from the excerpt header — never invent or estimate one.",
    "Omit locator entirely when the excerpt you used has none.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"keyPoints": [{"point": string, "source_id": string, "locator": {"type": "page"|"timestamp", "value": number|string} (optional)}]}',
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
