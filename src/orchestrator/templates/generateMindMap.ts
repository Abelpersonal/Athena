import { z } from "zod";
import { registerTemplate } from "./registry.js";
import type { ValidateExtraResult } from "../index.js";

/**
 * Mind Map Agent (Phase 8, PRD §5.12): one [LLM] call converting a finalized course structure
 * into a hierarchical concept node/edge graph. Every node's `lessonId` and every edge's
 * source/target must be copied VERBATIM from the real lesson list given in context — the same
 * "the model reports references, code validates them" discipline `sequence_modules`' tempId
 * pattern and `compare_findings_to_facts`' relatedLessonId pattern already use elsewhere in this
 * codebase — never an id the model invents. `createGenerateMindMapValidator` enforces this.
 */
export const GenerateMindMapOutputSchema = z.object({
  nodes: z
    .array(
      z.object({
        lessonId: z.string().min(1),
        conceptLabel: z.string().min(1),
      })
    )
    .min(1),
  edges: z
    .array(
      z.object({
        source: z.string().min(1),
        target: z.string().min(1),
        type: z.enum(["prerequisite", "cross_link"]),
      })
    )
    .default([]),
});
export type GenerateMindMapOutput = z.infer<typeof GenerateMindMapOutputSchema>;

export interface GenerateMindMapLessonRef {
  lessonId: string;
  title: string;
  description: string;
  moduleTitle: string;
}

export interface GenerateMindMapContext {
  courseTopic: string;
  lessons: GenerateMindMapLessonRef[];
}

/** Every node's lessonId must be real; every edge's source/target must reference a node actually present in THIS graph's own `nodes` array (not just the broader lesson id set) — the frontend must never have to handle a dangling edge. */
export function createGenerateMindMapValidator(
  knownLessonIds: ReadonlySet<string>
): (data: unknown) => ValidateExtraResult {
  return (data: unknown): ValidateExtraResult => {
    const output = data as GenerateMindMapOutput;

    const invalidNodes = output.nodes.filter((n) => !knownLessonIds.has(n.lessonId));
    if (invalidNodes.length > 0) {
      return {
        success: false,
        error:
          `nodes referenced lessonId(s) that aren't real lessons in this course: ${invalidNodes.map((n) => n.lessonId).join(", ")}. ` +
          `Every node's lessonId must be copied verbatim from the provided lesson list — never invent one.`,
      };
    }

    const nodeIds = new Set(output.nodes.map((n) => n.lessonId));
    const danglingEdges = output.edges.filter((e) => !nodeIds.has(e.source) || !nodeIds.has(e.target));
    if (danglingEdges.length > 0) {
      return {
        success: false,
        error:
          `edge(s) reference a lessonId not present in this graph's own "nodes" array: ${danglingEdges
            .map((e) => `${e.source} -> ${e.target}`)
            .join(", ")}. Every edge's source/target must be one of the lessonIds listed in "nodes".`,
      };
    }

    return { success: true };
  };
}

registerTemplate<GenerateMindMapContext, GenerateMindMapOutput>({
  taskType: "generate_mind_map",
  version: "1.0.0",
  systemPrompt: [
    "You convert a finished course into a hierarchical MIND MAP — concept nodes and the edges",
    "between them — for a learner to navigate visually, not a restatement of the module list.",
    "",
    "Each lesson below is a candidate concept node. You don't have to include every lesson (a",
    "genuine subset is fine when several lessons are really facets of one bigger idea, or a lesson",
    "is minor enough not to deserve its own node) — but every node you DO create must correspond to",
    "exactly one lesson from the list, referenced by its real lessonId, copied VERBATIM. Never",
    "invent a lessonId, and never create a node for anything that isn't in the list.",
    "",
    '"conceptLabel" is your own short, concise framing of the concept (a few words) — it can differ',
    "from the lesson's full title; this is what a learner sees as the node's label on the graph.",
    "",
    "Edges express real relationships: \"prerequisite\" (understanding the source concept is needed",
    'before the target one) or "cross_link" (the two concepts are related/connected but neither',
    "strictly requires the other first). Every edge's source and target must be a lessonId you",
    "actually used in \"nodes\" — never reference a lessonId you didn't include as a node.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"nodes": [{"lessonId": string, "conceptLabel": string}], "edges": [{"source": string, "target": string, "type": "prerequisite" | "cross_link"}]}',
  ].join("\n"),
  buildUserPrompt: (context) =>
    [
      `Course: "${context.courseTopic}"`,
      "",
      "Lessons (use these exact lessonId values):",
      ...context.lessons.map(
        (l) => `- lessonId: ${l.lessonId} | module: ${l.moduleTitle} | title: ${l.title} | ${l.description}`
      ),
    ].join("\n"),
  outputSchema: GenerateMindMapOutputSchema,
  maxTokens: 3072,
  effort: "medium",
  thinking: true,
});
