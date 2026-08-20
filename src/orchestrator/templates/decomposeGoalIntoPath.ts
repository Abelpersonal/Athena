import { z } from "zod";
import { registerTemplate } from "./registry.js";
import type { ValidateExtraResult } from "../index.js";

/**
 * Goal Planner (Phase 5) Deliverable 2 step 1: decompose a broad goal into
 * skill domains, then topics within each domain. tempIds are the model's own
 * short identifiers (mirroring sequenceModules' tempId pattern) so step 2's
 * dependency-mapping call can reference them.
 */
export const DecomposeGoalIntoPathOutputSchema = z.object({
  domains: z
    .array(
      z.object({
        tempId: z.string().min(1),
        name: z.string().min(1),
      })
    )
    .min(1),
  topics: z
    .array(
      z.object({
        tempId: z.string().min(1),
        domainTempId: z.string().min(1),
        topicName: z.string().min(1),
        description: z.string().min(1),
      })
    )
    .min(1),
});
export type DecomposeGoalIntoPathOutput = z.infer<typeof DecomposeGoalIntoPathOutputSchema>;

export interface DecomposeGoalIntoPathContext {
  goalDescription: string;
}

/** Every topic's domainTempId must reference a real domain; domain/topic tempIds must be unique. */
export function createDecomposeGoalIntoPathValidator(): (data: unknown) => ValidateExtraResult {
  return (data: unknown) => {
    const output = data as DecomposeGoalIntoPathOutput;
    const domainIds = new Set(output.domains.map((d) => d.tempId));
    if (domainIds.size !== output.domains.length) {
      return { success: false, error: "Duplicate domain tempId values in decompose_goal_into_path response." };
    }
    const topicIds = new Set<string>();
    for (const t of output.topics) {
      if (topicIds.has(t.tempId)) {
        return { success: false, error: `decompose_goal_into_path wrote topic tempId "${t.tempId}" more than once.` };
      }
      topicIds.add(t.tempId);
      if (!domainIds.has(t.domainTempId)) {
        return {
          success: false,
          error: `Topic "${t.tempId}" references unknown domain tempId "${t.domainTempId}".`,
        };
      }
    }
    return { success: true };
  };
}

registerTemplate<DecomposeGoalIntoPathContext, DecomposeGoalIntoPathOutput>({
  taskType: "decompose_goal_into_path",
  version: "1.0.0",
  systemPrompt: [
    "You are a curriculum architect decomposing a broad learning GOAL into a multi-domain roadmap.",
    "",
    "Step 1: identify the skill DOMAINS this goal genuinely requires — largely independent areas of study",
    '(e.g. for "become a full-stack quant": Math, Programming, Finance/Markets). Keep domains to the real,',
    "substantial ones — don't split hairs, don't invent a domain that's really one topic dressed up.",
    "",
    "Step 2: within each domain, list the TOPICS a learner needs — each substantial enough to become its own",
    "course (comparable in scope to what a single-topic course-builder would decompose into subtopics), not",
    "so fine-grained that a topic is really a subtopic, and not so broad that one topic is really several",
    "courses' worth. If a genuinely large number of topics is warranted, that's fine — this is a personal",
    "tool, not a system that needs to protect itself from a big real answer.",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"domains": [{"tempId": string, "name": string}], "topics": [{"tempId": string, "domainTempId": string, "topicName": string, "description": string}]}',
    'tempId values are your own short identifiers (e.g. "d1", "t1") — invent them, keep them stable so later',
    "steps can reference them. Every topic must reference a real domainTempId.",
  ].join("\n"),
  buildUserPrompt: (context) => `Decompose this goal into domains and topics: "${context.goalDescription}"`,
  outputSchema: DecomposeGoalIntoPathOutputSchema,
  maxTokens: 4096,
  effort: "high",
  thinking: true,
});
