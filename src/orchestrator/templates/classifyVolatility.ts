import { z } from "zod";
import { registerTemplate } from "./registry.js";

/** Pipeline step 5: classify how quickly this topic's content goes stale. */
export const ClassifyVolatilityOutputSchema = z.object({
  tier: z.enum(["fast", "medium", "slow"]),
  justification: z.string().min(1),
});
export type ClassifyVolatilityOutput = z.infer<typeof ClassifyVolatilityOutputSchema>;

export interface VolatilitySourceSummary {
  url: string;
  domain: string;
  publishedDate?: string;
}

export interface ClassifyVolatilityContext {
  topic: string;
  sourcesUsed: VolatilitySourceSummary[];
}

registerTemplate<ClassifyVolatilityContext, ClassifyVolatilityOutput>({
  taskType: "classify_volatility",
  version: "1.0.0",
  systemPrompt: [
    "You classify how quickly a topic's factual content goes out of date, based on the topic itself and the",
    "sources actually used to research it (their domains and publish dates, where known).",
    "",
    "- fast: content that changes on a timescale of months (current tooling/APIs/frameworks, current events,",
    "  pricing, rapidly-evolving fields, product-specific how-tos).",
    "- medium: content that shifts over a few years (best practices, applied techniques, evolving standards).",
    "- slow: content that is stable for many years or longer (foundational theory, math, well-settled science,",
    "  historical fact).",
    "",
    "Use the domains and dates as evidence (e.g. many recent blog/news/vendor-docs sources suggests fast;",
    "mostly .edu/.gov/textbook-style or old-but-still-current sources suggests slow) but the final call should",
    "be about the topic's actual nature, not just source metadata.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"tier": "fast" | "medium" | "slow", "justification": string}',
    '"justification" is one sentence.',
  ].join("\n"),
  buildUserPrompt: (context) => {
    const sourceLines = context.sourcesUsed
      .map((s) => `- ${s.domain} (${s.publishedDate ?? "publish date unknown"}) — ${s.url}`)
      .join("\n");
    return [
      `Topic: ${context.topic}`,
      "",
      "Sources used during research:",
      sourceLines || "(no sources recorded)",
    ].join("\n");
  },
  outputSchema: ClassifyVolatilityOutputSchema,
  maxTokens: 256,
  effort: "low",
  thinking: false,
});
