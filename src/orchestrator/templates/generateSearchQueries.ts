import { z } from "zod";
import { registerTemplate } from "./registry.js";

/** Shared by both generate_search_queries (2a) and generate_contention_queries (2e). */
export const SearchQueriesOutputSchema = z.object({
  queries: z.array(z.string().min(1)).min(2).max(4),
});
export type SearchQueriesOutput = z.infer<typeof SearchQueriesOutputSchema>;

export interface GenerateSearchQueriesContext {
  topic: string;
  subtopicTitle: string;
  subtopicDescription: string;
  /** Set when this is a re-pass after a failed depth audit — steers queries toward the gap. */
  gapInstruction?: string;
}

registerTemplate<GenerateSearchQueriesContext, SearchQueriesOutput>({
  taskType: "generate_search_queries",
  version: "1.0.0",
  systemPrompt: [
    "You generate targeted web search queries to research a subtopic for a course.",
    "Generate 2-4 queries that together would surface authoritative, substantive material on the subtopic —",
    "not just an overview, but enough to explain it from intuition through to real mechanics and application.",
    "Vary the queries (don't just rephrase the same search) so they cover different angles of the subtopic.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"queries": string[]}',
  ].join("\n"),
  buildUserPrompt: (context) => {
    const lines = [
      `Overall topic: ${context.topic}`,
      `Subtopic: ${context.subtopicTitle}`,
      `Subtopic description: ${context.subtopicDescription}`,
    ];
    if (context.gapInstruction) {
      lines.push(
        "",
        `The previous research pass on this subtopic was too shallow: ${context.gapInstruction}`,
        "Generate queries that specifically target closing that gap."
      );
    }
    return lines.join("\n");
  },
  outputSchema: SearchQueriesOutputSchema,
  maxTokens: 512,
  effort: "low",
  thinking: false,
});
