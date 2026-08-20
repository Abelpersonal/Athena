import { z } from "zod";
import { registerTemplate } from "./registry.js";

/**
 * Continuous Learning Agent (Phase 6) step 2: identify candidate book titles for a just-completed
 * topic — foundational works plus current ones — and rank each into the PRD's three categories.
 * This is candidate generation only; src/continuousLearning/index.ts verifies every candidate via
 * the Open Library / Gutenberg MCP adapters before any of them are persisted, so a title the model
 * invents that doesn't actually exist (or doesn't have a real current edition) never reaches the
 * Book table.
 */
export const GenerateBookCandidatesOutputSchema = z.object({
  candidates: z
    .array(
      z.object({
        title: z.string().min(1),
        author: z.string().min(1),
        category: z.enum(["core", "optional_deep_dive", "primary_source"]),
        rationale: z.string().min(1),
      })
    )
    .min(1),
});
export type GenerateBookCandidatesOutput = z.infer<typeof GenerateBookCandidatesOutputSchema>;

export interface GenerateBookCandidatesContext {
  topic: string;
  goalContext?: string;
  /** A short summary of what the course actually covered — grounds candidates in the real content, not just the bare topic name. */
  courseSummary: string;
}

registerTemplate<GenerateBookCandidatesContext, GenerateBookCandidatesOutput>({
  taskType: "generate_book_candidates",
  version: "1.0.0",
  systemPrompt: [
    "A learner just finished a course on a topic and is deciding what to read next. Suggest real,",
    "specific book titles worth their time — never a vague genre or a made-up title.",
    "",
    "Identify a mix across three categories:",
    '- "core": the single best foundational book(s) most learners in this topic should read.',
    '- "optional_deep_dive": worthwhile but more specialized — for a learner who wants to go further.',
    '- "primary_source": an original/foundational text in the field (a classic paper-turned-book, a',
    "  founding author's own work) — only include this category when a genuine primary source",
    "  exists and fits; don't force one.",
    "",
    "Suggest 3-6 candidates total across these categories, weighted toward quality over quantity.",
    "Every title and author must be a REAL, publishable book you're confident actually exists —",
    "a later verification step will look each one up and discard anything that isn't found, so a",
    "made-up or misremembered title just wastes that step. When genuinely unsure whether a title is",
    "real, prefer a book you're more confident about over guessing.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"candidates": [{"title": string, "author": string, "category": "core" | "optional_deep_dive" | "primary_source", "rationale": string}]}',
    '"rationale" is 1 sentence on why this book, specifically, fits this learner\'s next step.',
  ].join("\n"),
  buildUserPrompt: (context) =>
    [
      `Topic just completed: "${context.topic}"`,
      context.goalContext ? `Goal context: ${context.goalContext}` : undefined,
      `What the course covered: ${context.courseSummary}`,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n"),
  outputSchema: GenerateBookCandidatesOutputSchema,
  maxTokens: 2048,
  effort: "medium",
  thinking: false,
});
