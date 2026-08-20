import { z } from "zod";
import { registerTemplate } from "./registry.js";

/**
 * Continuous Learning Agent (Phase 6) step 3: what to learn next, in two modes — "deepen" (the
 * natural next step within the same domain) and "branch" (an adjacent or novel domain). Framed
 * per the PRD as encouraging continued engagement, never manipulating it: no artificial urgency,
 * no dark patterns, no "you'll fall behind if you don't" framing — reasoning should read like a
 * good mentor's honest suggestion, not a retention hook.
 */
export const GenerateNextTopicSuggestionsOutputSchema = z.object({
  deepen: z.object({
    topicName: z.string().min(1),
    description: z.string().min(1),
    rationale: z.string().min(1),
  }),
  branch: z.object({
    topicName: z.string().min(1),
    description: z.string().min(1),
    domain: z.string().min(1),
    rationale: z.string().min(1),
  }),
});
export type GenerateNextTopicSuggestionsOutput = z.infer<typeof GenerateNextTopicSuggestionsOutputSchema>;

export interface GenerateNextTopicSuggestionsContext {
  topic: string;
  goalContext?: string;
  courseSummary: string;
  /** Topic names connected to this one elsewhere in the Memory Graph (getCrossCourseConnections) — real signal, not invented. */
  crossCourseConnections: string[];
  /** Set when getRecentCourseDomains/isDomainClusterNarrow (src/continuousLearning/index.ts) found the learner's recent courses clustering in one domain. */
  diversityBiasNeeded: boolean;
  recentDomains: string[];
}

registerTemplate<GenerateNextTopicSuggestionsContext, GenerateNextTopicSuggestionsOutput>({
  taskType: "generate_next_topic_suggestions",
  version: "1.0.0",
  systemPrompt: [
    "A learner just finished a course. Suggest what to learn next, in TWO modes:",
    "",
    '- "deepen": the natural next step within the SAME domain — a logical continuation building on',
    "  what they just learned.",
    '- "branch": an ADJACENT or genuinely novel domain — something worth exploring next that isn\'t',
    "  just more of the same. When cross-course connections are provided below, prefer a branch that",
    "  actually uses one of those real connections over an unconnected guess.",
    "",
    "Tone matters: suggest like a good mentor giving an honest, specific recommendation — never",
    'create artificial urgency ("don\'t fall behind", streak/pressure language) and never use dark',
    "patterns to manufacture engagement. A genuinely useful, well-reasoned suggestion is the entire",
    "goal.",
    "",
    "If told the learner's recent topics are clustering narrowly in one domain, the branch",
    "suggestion MUST come from a genuinely different domain than that cluster — treat this as a hard",
    "constraint on the branch pick, not a soft preference.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"deepen": {"topicName": string, "description": string, "rationale": string}, "branch": {"topicName": string, "description": string, "domain": string, "rationale": string}}',
  ].join("\n"),
  buildUserPrompt: (context) =>
    [
      `Topic just completed: "${context.topic}"`,
      context.goalContext ? `Goal context: ${context.goalContext}` : undefined,
      `What the course covered: ${context.courseSummary}`,
      context.crossCourseConnections.length > 0
        ? `Real cross-course connections already in this learner's graph: ${context.crossCourseConnections.join(", ")}`
        : "No cross-course connections found for this topic yet.",
      context.diversityBiasNeeded
        ? `The learner's last several completed courses cluster narrowly in: ${context.recentDomains.join(", ")}. The branch suggestion MUST be from a genuinely different domain.`
        : undefined,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n"),
  outputSchema: GenerateNextTopicSuggestionsOutputSchema,
  maxTokens: 2048,
  effort: "medium",
  thinking: true,
});
