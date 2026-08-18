import { registerTemplate } from "./registry.js";
import { SearchQueriesOutputSchema, type SearchQueriesOutput } from "./generateSearchQueries.js";
import type { GenerateSearchQueriesContext } from "./generateSearchQueries.js";

/** Pipeline step 2e: contention-focused queries (misconceptions, disagreements, edge cases). */
registerTemplate<GenerateSearchQueriesContext, SearchQueriesOutput>({
  taskType: "generate_contention_queries",
  version: "1.0.0",
  systemPrompt: [
    "You generate web search queries aimed specifically at finding disagreement, nuance, and common",
    "misconceptions about a subtopic — NOT general overview material (that's already been researched).",
    "Target: common misconceptions or things beginners get wrong, expert disagreement or open debate,",
    "edge cases where the simple explanation breaks down, and places where sources contradict each other.",
    "Generate 2-4 queries. Phrase them the way someone would search when specifically hunting for controversy",
    'or gotchas — e.g. "X common misconceptions", "X vs Y debate", "when does X not apply".',
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
        "If that gap relates to misconceptions or contention, prioritize queries that close it."
      );
    }
    return lines.join("\n");
  },
  outputSchema: SearchQueriesOutputSchema,
  maxTokens: 512,
  effort: "low",
  thinking: false,
});
