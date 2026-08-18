import { z } from "zod";
import { registerTemplate } from "./registry.js";
import type { ValidateExtraResult } from "../index.js";

/** Course Builder step 2: given the sequencing from sequence_modules, write final titles/descriptions/durations. */
export const WriteLessonMetadataOutputSchema = z.object({
  modules: z
    .array(
      z.object({
        tempId: z.string().min(1),
        title: z.string().min(1),
        description: z.string().min(1),
      })
    )
    .min(1),
  lessons: z
    .array(
      z.object({
        subtopicId: z.string().min(1),
        title: z.string().min(1),
        description: z.string().min(1),
        /** A rough estimate like "12 min read/listen" — not a rigorous word-count formula (v1 scope). */
        estimatedDuration: z.string().min(1),
      })
    )
    .min(1),
});
export type WriteLessonMetadataOutput = z.infer<typeof WriteLessonMetadataOutputSchema>;

export interface WriteLessonMetadataModuleRef {
  tempId: string;
  subtopics: Array<{ id: string; title: string; description: string }>;
}

export interface WriteLessonMetadataContext {
  topic: string;
  modules: WriteLessonMetadataModuleRef[];
}

export function createWriteLessonMetadataValidator(
  moduleTempIds: Set<string>,
  subtopicIds: Set<string>
): (data: unknown) => ValidateExtraResult {
  return (data: unknown) => {
    const output = data as WriteLessonMetadataOutput;

    const seenModules = new Set<string>();
    for (const m of output.modules) {
      if (!moduleTempIds.has(m.tempId)) {
        return { success: false, error: `write_lesson_metadata referenced unknown module tempId "${m.tempId}".` };
      }
      if (seenModules.has(m.tempId)) {
        return { success: false, error: `write_lesson_metadata wrote module tempId "${m.tempId}" more than once.` };
      }
      seenModules.add(m.tempId);
    }
    const missingModules = [...moduleTempIds].filter((id) => !seenModules.has(id));
    if (missingModules.length > 0) {
      return { success: false, error: `write_lesson_metadata omitted module tempId(s): ${missingModules.join(", ")}.` };
    }

    const seenLessons = new Set<string>();
    for (const l of output.lessons) {
      if (!subtopicIds.has(l.subtopicId)) {
        return { success: false, error: `write_lesson_metadata referenced unknown subtopic id "${l.subtopicId}".` };
      }
      if (seenLessons.has(l.subtopicId)) {
        return { success: false, error: `write_lesson_metadata wrote subtopic id "${l.subtopicId}" more than once.` };
      }
      seenLessons.add(l.subtopicId);
    }
    const missingLessons = [...subtopicIds].filter((id) => !seenLessons.has(id));
    if (missingLessons.length > 0) {
      return { success: false, error: `write_lesson_metadata omitted subtopic id(s): ${missingLessons.join(", ")}.` };
    }

    return { success: true };
  };
}

registerTemplate<WriteLessonMetadataContext, WriteLessonMetadataOutput>({
  taskType: "write_lesson_metadata",
  version: "1.0.0",
  systemPrompt: [
    "You are writing learner-facing metadata for a course whose modules and lessons have already been",
    "sequenced. For each module, write a short, engaging title and a 1-2 sentence description of what it",
    "covers and why it's grouped together. For each lesson (one per subtopic), write a short title (may",
    "differ from the research subtopic title if a punchier learner-facing phrasing fits better), a 1-2",
    "sentence description, and a rough estimated duration as a short string like \"12 min read/listen\"",
    "(a reasonable estimate given the subtopic's apparent depth — not a precise word-count calculation).",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"modules": [{"tempId": string, "title": string, "description": string}], ' +
      '"lessons": [{"subtopicId": string, "title": string, "description": string, "estimatedDuration": string}]}',
    "Cover every module tempId and every subtopic id given to you exactly once.",
  ].join("\n"),
  buildUserPrompt: (context) => {
    const lines = [`Topic: "${context.topic}"`, "", "Modules (in final teaching order):"];
    for (const m of context.modules) {
      lines.push(`- module tempId: ${m.tempId}`);
      for (const s of m.subtopics) {
        lines.push(`    - subtopic id: ${s.id} | working title: ${s.title} | ${s.description}`);
      }
    }
    return lines.join("\n");
  },
  outputSchema: WriteLessonMetadataOutputSchema,
  maxTokens: 4096,
  effort: "medium",
  thinking: false,
});
