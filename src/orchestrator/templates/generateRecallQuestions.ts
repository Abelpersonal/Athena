import { z } from "zod";
import { registerTemplate } from "./registry.js";
import type { CourseLessonLayers } from "../../db/schema.js";

/**
 * Quiz Engine tier 1: recall. Direct fact/definition questions grounded in
 * the lesson's own persisted content (title, description, and its five
 * layers) — never generic, ungrounded trivia.
 */
export const QuizQuestionsOutputSchema = z.object({
  questions: z
    .array(
      z.discriminatedUnion("type", [
        z.object({
          type: z.literal("multiple_choice"),
          prompt: z.string().min(1),
          options: z.array(z.string().min(1)).min(3).max(6),
          correctOptionIndex: z.number().int().min(0),
        }),
        z.object({
          type: z.literal("free_text"),
          prompt: z.string().min(1),
          /** What a good answer must contain, grounded in this lesson's content — fed to the semantic scorer so it grades against the lesson, not its own general knowledge. */
          rubric: z.string().min(1),
        }),
      ])
    )
    .min(1),
});
export type QuizQuestionsOutput = z.infer<typeof QuizQuestionsOutputSchema>;

export interface GenerateQuizQuestionsContext {
  lessonTitle: string;
  lessonDescription: string;
  layers: CourseLessonLayers;
  numQuestions: number;
}

export function formatLessonContent(context: GenerateQuizQuestionsContext): string {
  const layerText = (name: string, layer: { text: string }) => `### ${name}\n${layer.text}`;
  return [
    `Lesson: ${context.lessonTitle}`,
    context.lessonDescription,
    "",
    "LESSON CONTENT:",
    layerText("Intuition", context.layers.intuition),
    layerText("Mechanics", context.layers.mechanics),
    layerText("Formal", context.layers.formal),
    layerText("Application", context.layers.application),
    layerText("Frontier", context.layers.frontier),
  ].join("\n");
}

const RESPONSE_SHAPE_NOTE =
  '{"questions": [{"type": "multiple_choice", "prompt": string, "options": string[], "correctOptionIndex": number} ' +
  '| {"type": "free_text", "prompt": string, "rubric": string}]}';

registerTemplate<GenerateQuizQuestionsContext, QuizQuestionsOutput>({
  taskType: "generate_recall_questions",
  version: "1.0.0",
  systemPrompt: [
    "You write RECALL-tier quiz questions for a course lesson — direct fact/definition questions that test",
    "whether the learner remembers what the lesson actually said, not whether they can apply or extend it.",
    "Every question must be answerable directly from the LESSON CONTENT given to you — do not test outside",
    "knowledge, and do not invent facts not present in the lesson.",
    "",
    "Mix question types: use multiple_choice for a question with a clear single correct answer among",
    "plausible distractors (3-6 options, correctOptionIndex is 0-based), and free_text for a question best",
    "answered in the learner's own words (a short definition or fact) — for free_text questions, write a",
    "rubric describing exactly what a correct answer must contain, grounded in the lesson content, so it can",
    "be graded later without re-reading the whole lesson.",
    "",
    "Generate exactly the requested number of questions.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    RESPONSE_SHAPE_NOTE,
  ].join("\n"),
  buildUserPrompt: (context) =>
    [formatLessonContent(context), "", `Generate exactly ${context.numQuestions} recall-tier question(s).`].join(
      "\n"
    ),
  outputSchema: QuizQuestionsOutputSchema,
  maxTokens: 2048,
  effort: "medium",
  thinking: false,
});
