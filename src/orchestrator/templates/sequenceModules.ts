import { z } from "zod";
import { registerTemplate } from "./registry.js";
import type { ValidateExtraResult } from "../index.js";

/**
 * Course Builder step 1: group Phase 2's subtopics into modules and record
 * which modules depend on which — the raw dependency graph, not yet a
 * linear order. Code (courseBuilder/sequence.ts) turns this into an actual
 * order via topological sort, rather than trusting the model to produce a
 * self-consistent total order directly.
 */
export const SequenceModulesOutputSchema = z.object({
  modules: z
    .array(
      z.object({
        tempId: z.string().min(1),
        /** Subtopic ids belonging to this module, in the order they should be taught within it. */
        subtopicIds: z.array(z.string().min(1)).min(1),
        /** tempIds of OTHER modules that depend on this one (i.e. this module is a prerequisite of them). */
        prerequisiteOfTempIds: z.array(z.string()),
      })
    )
    .min(1),
});
export type SequenceModulesOutput = z.infer<typeof SequenceModulesOutputSchema>;

export interface SequenceModulesSubtopicRef {
  id: string;
  title: string;
  description: string;
}

export interface SequenceModulesContext {
  topic: string;
  externalPrerequisites: string[];
  subtopics: SequenceModulesSubtopicRef[];
}

/**
 * Every subtopic must land in exactly one module, and every prerequisiteOf
 * edge must point at a tempId that's actually in the response — the model
 * is not trusted to self-report a consistent graph.
 */
export function createSequenceModulesValidator(
  subtopicIds: Set<string>
): (data: unknown) => ValidateExtraResult {
  return (data: unknown) => {
    const output = data as SequenceModulesOutput;
    const tempIds = new Set(output.modules.map((m) => m.tempId));
    if (tempIds.size !== output.modules.length) {
      return { success: false, error: "Duplicate module tempId values in sequence_modules response." };
    }

    const seenSubtopics = new Map<string, number>();
    for (const m of output.modules) {
      for (const sid of m.subtopicIds) {
        seenSubtopics.set(sid, (seenSubtopics.get(sid) ?? 0) + 1);
        if (!subtopicIds.has(sid)) {
          return { success: false, error: `sequence_modules referenced unknown subtopic id "${sid}".` };
        }
      }
      for (const edge of m.prerequisiteOfTempIds) {
        if (!tempIds.has(edge)) {
          return {
            success: false,
            error: `Module "${m.tempId}" lists prerequisiteOfTempIds edge to unknown tempId "${edge}".`,
          };
        }
      }
    }

    const missing = [...subtopicIds].filter((sid) => !seenSubtopics.has(sid));
    if (missing.length > 0) {
      return { success: false, error: `sequence_modules omitted subtopic id(s): ${missing.join(", ")}.` };
    }
    const duplicated = [...seenSubtopics.entries()].filter(([, count]) => count > 1).map(([sid]) => sid);
    if (duplicated.length > 0) {
      return {
        success: false,
        error: `sequence_modules assigned subtopic id(s) to more than one module: ${duplicated.join(", ")}.`,
      };
    }

    return { success: true };
  };
}

registerTemplate<SequenceModulesContext, SequenceModulesOutput>({
  taskType: "sequence_modules",
  version: "1.0.0",
  systemPrompt: [
    "You are a curriculum designer sequencing a course's already-researched subtopics into modules.",
    "",
    "Group subtopics into modules by theme and teaching order. A module can hold one subtopic or several",
    "closely related ones. Within a module, order subtopicIds in the sequence a learner should study them.",
    "",
    "Then record prerequisite structure BETWEEN modules: prerequisiteOfTempIds on a module lists the tempIds",
    "of OTHER modules that genuinely depend on it — i.e. a learner needs this module before those ones make",
    "sense. Only record a real, substantive dependency (e.g. this module defines a concept the other module's",
    "content assumes) — do not invent dependencies just to create structure, and never list a module as its",
    "own prerequisite.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"modules": [{"tempId": string, "subtopicIds": string[], "prerequisiteOfTempIds": string[]}]}',
    "Every subtopic id given to you must appear in exactly one module's subtopicIds — do not omit or duplicate any.",
    "tempId values are your own short identifiers (e.g. \"m1\", \"m2\") — invent them, but keep them stable across",
    "the modules array so prerequisiteOfTempIds can reference them.",
  ].join("\n"),
  buildUserPrompt: (context) => {
    const lines = [
      `Topic: "${context.topic}"`,
      context.externalPrerequisites.length > 0
        ? `External prerequisites (assumed already known, NOT part of this course): ${context.externalPrerequisites.join(", ")}`
        : "No external prerequisites were recorded.",
      "",
      "Subtopics to sequence:",
      ...context.subtopics.map((s) => `- id: ${s.id} | title: ${s.title} | ${s.description}`),
    ];
    return lines.join("\n");
  },
  outputSchema: SequenceModulesOutputSchema,
  maxTokens: 3072,
  effort: "high",
  thinking: true,
});
