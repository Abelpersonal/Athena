import { z } from "zod";
import { registerTemplate } from "./registry.js";
import type { ValidateExtraResult } from "../index.js";

/**
 * Knowledge Update Agent (Phase 6) step 2c: the severity classifier — the core judgment call of
 * this whole agent. Compares freshly-found information against the topic's existing Memory Graph
 * facts and classifies each real delta. The rubric below gives concrete anchors per the PRD
 * (vague severity labels without a rubric produce inconsistent classifications), and every delta
 * must name a `relatedLessonId` from the course's own lesson list — validated below against the
 * real id set, the same pattern createDecomposeGoalIntoPathValidator (Phase 5) uses for tempId
 * references — since the Memory Graph's facts don't retain which lesson they came from (see
 * README, "Which lesson does a delta belong to").
 */
export const CompareFindingsToFactsOutputSchema = z.object({
  deltas: z
    .array(
      z.object({
        existingFactSummary: z.string().min(1),
        newFindingSummary: z.string().min(1),
        severity: z.enum(["none", "minor", "moderate", "major"]),
        explanation: z.string().min(1),
        relatedLessonId: z.string().min(1),
      })
    )
    .default([]),
});
export type CompareFindingsToFactsOutput = z.infer<typeof CompareFindingsToFactsOutputSchema>;

export interface CompareFindingsToFactsLessonRef {
  id: string;
  title: string;
  description: string;
}

export interface CompareFindingsToFactsContext {
  topic: string;
  existingFacts: string[];
  newFindings: Array<{ title: string; url: string; text: string }>;
  lessons: CompareFindingsToFactsLessonRef[];
}

/** Every delta's relatedLessonId must reference a real lesson from the course's own lesson list. */
export function createCompareFindingsToFactsValidator(
  knownLessonIds: Set<string>
): (data: unknown) => ValidateExtraResult {
  return (data: unknown) => {
    const output = data as CompareFindingsToFactsOutput;
    for (const delta of output.deltas) {
      if (!knownLessonIds.has(delta.relatedLessonId)) {
        return {
          success: false,
          error: `compare_findings_to_facts named relatedLessonId "${delta.relatedLessonId}", which isn't one of this course's real lesson ids.`,
        };
      }
    }
    return { success: true };
  };
}

registerTemplate<CompareFindingsToFactsContext, CompareFindingsToFactsOutput>({
  taskType: "compare_findings_to_facts",
  version: "1.0.0",
  systemPrompt: [
    "Compare freshly-found information about a topic against what's already known, and classify",
    "every REAL delta (a finding that actually says something different from an existing fact) —",
    "not a full re-audit of everything, just the differences.",
    "",
    "Severity rubric (use these concrete anchors, not your own judgment of what counts as big):",
    '- "none": the new finding just restates or agrees with an existing fact — not a real delta at',
    "  all. Don't include these in the output.",
    '- "minor": wording, phrasing, level of detail, or citation/source changes that DON\'T affect the',
    "  substance of what's taught — the underlying fact is still correct as stated.",
    '- "moderate": a meaningfully updated fact, figure, statistic, or recommended method/practice —',
    "  the old version isn't simply wrong, but a materially better/more current answer now exists.",
    '- "major": a core claim is REVERSED, deprecated, or superseded entirely — what was taught is now',
    "  actively wrong or obsolete, not just improvable.",
    "",
    "Every delta you report must name relatedLessonId — the id of whichever lesson from the provided",
    "list this delta is actually about (pick the single best match; every lesson listed has a real",
    "id you must use verbatim).",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"deltas": [{"existingFactSummary": string, "newFindingSummary": string, "severity": "none" | "minor" | "moderate" | "major", "explanation": string, "relatedLessonId": string}]}',
    "Return an empty deltas array if nothing found actually differs from what's already known.",
  ].join("\n"),
  buildUserPrompt: (context) =>
    [
      `Topic: "${context.topic}"`,
      "",
      "Existing facts:",
      ...context.existingFacts.map((f, i) => `${i + 1}. ${f}`),
      "",
      "Lessons in this course (use these exact ids for relatedLessonId):",
      ...context.lessons.map((l) => `- id: ${l.id} | title: ${l.title} | ${l.description}`),
      "",
      "Freshly found information:",
      ...context.newFindings.map((f, i) => `[${i + 1}] ${f.title} (${f.url})\n${f.text}`),
    ].join("\n"),
  outputSchema: CompareFindingsToFactsOutputSchema,
  maxTokens: 3072,
  effort: "high",
  thinking: true,
});
