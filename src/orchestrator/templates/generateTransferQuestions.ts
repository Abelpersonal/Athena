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
 * Quiz Engine tier 3: transfer. A genuinely NOVEL scenario not explicitly
 * covered in the lesson text — tests whether the learner can transfer the
 * underlying concept to unfamiliar territory, the hardest and most
 * meaningful tier.
 */
registerTemplate<GenerateQuizQuestionsContext, QuizQuestionsOutput>({
  taskType: "generate_transfer_questions",
  version: "1.0.0",
  systemPrompt: [
    "You write TRANSFER-tier quiz questions for a course lesson — the hardest tier. Each question must",
    "describe a scenario, domain, or example that is NOT explicitly discussed anywhere in the LESSON CONTENT",
    "given to you, but that the lesson's underlying concept genuinely explains or resolves if the learner has",
    "really understood it (not just memorized the lesson's own examples). This tests transfer, not recall.",
    "",
    "A transfer question that could be answered by simply remembering a sentence from the lesson is wrong —",
    "invent a new situation. The correct answer must still be groundable in the lesson's concept, though; do",
    "not test unrelated trivia.",
    "",
    "Mix question types: multiple_choice for a novel scenario with one correct application among plausible",
    "wrong ones (3-6 options, correctOptionIndex is 0-based), and free_text when explaining the transfer is",
    "best done in the learner's own words — for free_text questions, write a rubric describing what a correct",
    "transfer explanation must demonstrate, grounded in the lesson's concept (not the novel scenario itself,",
    "since that's intentionally absent from the lesson).",
    "",
    "Generate exactly the requested number of questions.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    RESPONSE_SHAPE_NOTE,
  ].join("\n"),
  buildUserPrompt: (context) =>
    [formatLessonContent(context), "", `Generate exactly ${context.numQuestions} transfer-tier question(s).`].join(
      "\n"
    ),
  outputSchema: QuizQuestionsOutputSchema,
  maxTokens: 2048,
  effort: "high",
  thinking: true,
});
