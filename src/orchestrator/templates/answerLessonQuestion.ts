import { z } from "zod";
import { registerTemplate } from "./registry.js";

/**
 * Phase 7's Lesson/Teaching screen: the one genuinely missing backend piece needed to make
 * text-question Q&A real rather than a static content viewer (see src/teachingEngine/
 * answerLessonQuestion.ts). Grounding is strictly the lesson's own five layers plus its cited
 * sources — never general knowledge beyond that — and is CHECKABLE, not just prompted: the model
 * must return which source_ids it actually drew on, validated against the real set via
 * createCitationValidator (src/research/grounding.ts, reused unchanged from the Research Agent).
 */
export const AnswerLessonQuestionOutputSchema = z.object({
  answer: z.string().min(1),
  /** source_ids from the provided list that this answer actually drew on — [] is valid (e.g. an intuition-level answer that doesn't need a citation). */
  sourceIds: z.array(z.string()),
  /** true when the lesson's content genuinely doesn't cover what was asked — the answer should say so honestly rather than inventing one. */
  outsideLessonScope: z.boolean(),
});
export type AnswerLessonQuestionOutput = z.infer<typeof AnswerLessonQuestionOutputSchema>;

export interface AnswerLessonQuestionSourceRef {
  source_id: string;
  title: string;
  text: string;
}

export interface AnswerLessonQuestionContext {
  lessonTitle: string;
  layers: {
    intuition: string;
    mechanics: string;
    formal: string;
    application: string;
    frontier: string;
  };
  sources: AnswerLessonQuestionSourceRef[];
  question: string;
}

registerTemplate<AnswerLessonQuestionContext, AnswerLessonQuestionOutput>({
  taskType: "answer_lesson_question",
  version: "1.0.0",
  systemPrompt: [
    "A learner is asking a question about a specific lesson they're currently studying. Answer",
    "using ONLY the lesson's five layers and its cited sources below — never general knowledge",
    "beyond what's actually there. If the lesson genuinely doesn't cover what's being asked, say so",
    'honestly ("outsideLessonScope": true) rather than inventing an answer from outside knowledge.',
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"answer": string, "sourceIds": string[], "outsideLessonScope": boolean}',
    '"sourceIds" lists which of the provided source_ids this answer actually drew on — only cite',
    "ones you were actually given, never invent one; an answer grounded purely in the lesson's own",
    "layer text (no specific source needed) can return an empty array.",
  ].join("\n"),
  buildUserPrompt: (context) =>
    [
      `Lesson: "${context.lessonTitle}"`,
      "",
      "Layers:",
      `[intuition] ${context.layers.intuition}`,
      `[mechanics] ${context.layers.mechanics}`,
      `[formal] ${context.layers.formal}`,
      `[application] ${context.layers.application}`,
      `[frontier] ${context.layers.frontier}`,
      "",
      "Cited sources:",
      ...context.sources.map((s) => `[source_id: ${s.source_id}] ${s.title}\n${s.text}`),
      "",
      `Learner's question: ${context.question}`,
    ].join("\n"),
  outputSchema: AnswerLessonQuestionOutputSchema,
  maxTokens: 1536,
  effort: "medium",
  thinking: false,
});
