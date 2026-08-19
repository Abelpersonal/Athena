import { z } from "zod";
import { registerTemplate } from "./registry.js";

/**
 * Quiz Engine step 3: semantic (not keyword-match) scoring of a free-text
 * answer against the question's rubric. Score is 0-1 continuous — see
 * quizEngine/index.ts for how this combines with objective-question scores
 * into a tier score and MasteryState.knowledgeScore.
 */
export const ScoreFreeTextAnswerOutputSchema = z.object({
  score: z.number().min(0).max(1),
  explanation: z.string().min(1),
});
export type ScoreFreeTextAnswerOutput = z.infer<typeof ScoreFreeTextAnswerOutputSchema>;

export interface ScoreFreeTextAnswerContext {
  questionPrompt: string;
  rubric: string;
  userAnswer: string;
}

registerTemplate<ScoreFreeTextAnswerContext, ScoreFreeTextAnswerOutput>({
  taskType: "score_free_text_answer",
  version: "1.0.0",
  systemPrompt: [
    "You grade a learner's free-text quiz answer against a rubric, using SEMANTIC understanding — not",
    "keyword matching. Award credit for an answer that correctly conveys the required understanding even if",
    "it uses different words or phrasing than the rubric; withhold credit for an answer that uses the right",
    "words but is conceptually wrong, vague, or missing what the rubric requires.",
    "",
    "Score continuously on a 0-1 scale (not just pass/fail): 1.0 is a complete, correct answer meeting every",
    "part of the rubric; partial credit (e.g. 0.4-0.7) for an answer that is partially correct, incomplete,",
    "or correct but poorly explained; 0.0-0.2 for an answer that is wrong, off-topic, or blank. Give a short",
    "explanation of what the answer got right and/or missed, specific to what the learner actually wrote.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"score": number, "explanation": string}',
  ].join("\n"),
  buildUserPrompt: (context) =>
    [
      `Question: ${context.questionPrompt}`,
      `Rubric (what a correct answer must contain): ${context.rubric}`,
      "",
      `Learner's answer: ${context.userAnswer || "(blank — no answer given)"}`,
    ].join("\n"),
  outputSchema: ScoreFreeTextAnswerOutputSchema,
  maxTokens: 512,
  effort: "medium",
  thinking: false,
});
