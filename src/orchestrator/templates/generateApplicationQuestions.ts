import { registerTemplate } from "./registry.js";
import {
  QuizQuestionsOutputSchema,
  formatLessonContent,
  type QuizQuestionsOutput,
  type GenerateQuizQuestionsContext,
} from "./generateRecallQuestions.js";

const RESPONSE_SHAPE_NOTE =
  '{"questions": [{"type": "multiple_choice", "prompt": string, "options": string[], "correctOptionIndex": number} ' +
  '| {"type": "free_text", "prompt": string, "rubric": string}]}';

/**
 * Quiz Engine tier 2: application. "Use this concept to solve X" — a
 * concrete problem the lesson's own concepts solve, not a restatement of a
 * fact from the lesson.
 */
registerTemplate<GenerateQuizQuestionsContext, QuizQuestionsOutput>({
  taskType: "generate_application_questions",
  version: "1.0.0",
  systemPrompt: [
    "You write APPLICATION-tier quiz questions for a course lesson — each question presents a concrete",
    "problem or situation and asks the learner to USE a concept from the lesson to solve or evaluate it.",
    "Do not just ask the learner to restate a definition (that's recall-tier, already covered elsewhere) —",
    "the question must require applying the lesson's mechanics/application-layer content to something",
    "specific, grounded in what the LESSON CONTENT actually teaches.",
    "",
    "Mix question types: multiple_choice for a problem with one clearly correct application among plausible",
    "wrong applications (3-6 options, correctOptionIndex is 0-based), and free_text when the application is",
    "best explained in the learner's own words — for free_text questions, write a rubric describing exactly",
    "what a correct application must demonstrate, grounded in the lesson content.",
    "",
    "Generate exactly the requested number of questions.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    RESPONSE_SHAPE_NOTE,
  ].join("\n"),
  buildUserPrompt: (context) =>
    [
      formatLessonContent(context),
      "",
      `Generate exactly ${context.numQuestions} application-tier question(s).`,
    ].join("\n"),
  outputSchema: QuizQuestionsOutputSchema,
  maxTokens: 2048,
  effort: "medium",
  thinking: true,
});
