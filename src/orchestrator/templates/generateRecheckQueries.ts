import { z } from "zod";
import { registerTemplate } from "./registry.js";

/**
 * Knowledge Update Agent (Phase 6) step 2a: a LIGHTER version of Phase 2's generate_search_queries
 * — 2-3 targeted "what's changed since this was researched" queries, not the full multi-pass
 * (initial + contention) query set a fresh course build uses. This is a targeted recheck, not a
 * re-research.
 */
export const GenerateRecheckQueriesOutputSchema = z.object({
  queries: z.array(z.string().min(1)).min(1).max(3),
});
export type GenerateRecheckQueriesOutput = z.infer<typeof GenerateRecheckQueriesOutputSchema>;

export interface GenerateRecheckQueriesContext {
  topic: string;
  /** A short sample of what's currently known, so queries target genuinely new/changed information rather than re-covering the basics. */
  existingFactsSummary: string;
}

registerTemplate<GenerateRecheckQueriesContext, GenerateRecheckQueriesOutput>({
  taskType: "generate_recheck_queries",
  version: "1.0.0",
  systemPrompt: [
    "Generate 1-3 SEARCH QUERIES to check whether a topic's currently-known facts are still",
    "accurate — a targeted staleness recheck, NOT a full re-research pass. Given what's already",
    "known about this topic, write queries aimed specifically at surfacing recent changes, updates,",
    'corrections, or new developments — e.g. lean toward "latest", "current", "as of <recent year>",',
    "or a specific claim's continued validity, rather than broad introductory queries that would",
    "just re-find the same established facts.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"queries": string[]}',
  ].join("\n"),
  buildUserPrompt: (context) =>
    [`Topic: "${context.topic}"`, `Currently known (summary): ${context.existingFactsSummary}`].join("\n"),
  outputSchema: GenerateRecheckQueriesOutputSchema,
  maxTokens: 512,
  effort: "low",
  thinking: false,
});
