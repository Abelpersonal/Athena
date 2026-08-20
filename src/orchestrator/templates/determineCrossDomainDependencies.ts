import { z } from "zod";
import { registerTemplate } from "./registry.js";
import type { ValidateExtraResult } from "../index.js";

/**
 * Goal Planner (Phase 5) Deliverable 2 step 2: prerequisite order ACROSS ALL
 * domains, not just within one — the actually hard part of this deliverable.
 * The model is not trusted to hand back a self-consistent order/parallelism
 * directly (same philosophy as sequence_modules): it only reports the raw
 * dependency EDGES; src/pathPlanner/ordering.ts's computeCrossDomainOrder()
 * turns that into actual tiers/parallel groups via a topological sort.
 */
export const DetermineCrossDomainDependenciesOutputSchema = z.object({
  dependencies: z
    .array(
      z.object({
        topicTempId: z.string().min(1),
        /** Other topics' tempIds (possibly in a different domain) that must come before this one. Empty if this topic has no real prerequisite among the given topics. */
        dependsOnTempIds: z.array(z.string()),
      })
    )
    .min(1),
});
export type DetermineCrossDomainDependenciesOutput = z.infer<typeof DetermineCrossDomainDependenciesOutputSchema>;

export interface CrossDomainTopicRef {
  tempId: string;
  domainTempId: string;
  domainName: string;
  topicName: string;
  description: string;
}

export interface DetermineCrossDomainDependenciesContext {
  goalDescription: string;
  topics: CrossDomainTopicRef[];
}

/** Every topic tempId must appear exactly once; every dependsOnTempIds entry must reference a real, different topic. */
export function createDetermineCrossDomainDependenciesValidator(
  topicIds: Set<string>
): (data: unknown) => ValidateExtraResult {
  return (data: unknown) => {
    const output = data as DetermineCrossDomainDependenciesOutput;
    const seen = new Map<string, number>();
    for (const d of output.dependencies) {
      if (!topicIds.has(d.topicTempId)) {
        return { success: false, error: `determine_cross_domain_dependencies referenced unknown topic tempId "${d.topicTempId}".` };
      }
      seen.set(d.topicTempId, (seen.get(d.topicTempId) ?? 0) + 1);
      for (const dep of d.dependsOnTempIds) {
        if (!topicIds.has(dep)) {
          return {
            success: false,
            error: `Topic "${d.topicTempId}" lists an unknown dependsOn tempId "${dep}".`,
          };
        }
        if (dep === d.topicTempId) {
          return { success: false, error: `Topic "${d.topicTempId}" lists itself as its own dependency.` };
        }
      }
    }
    const missing = [...topicIds].filter((id) => !seen.has(id));
    if (missing.length > 0) {
      return { success: false, error: `determine_cross_domain_dependencies omitted topic tempId(s): ${missing.join(", ")}.` };
    }
    const duplicated = [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
    if (duplicated.length > 0) {
      return { success: false, error: `determine_cross_domain_dependencies listed topic tempId(s) more than once: ${duplicated.join(", ")}.` };
    }
    return { success: true };
  };
}

registerTemplate<DetermineCrossDomainDependenciesContext, DetermineCrossDomainDependenciesOutput>({
  taskType: "determine_cross_domain_dependencies",
  version: "1.0.0",
  systemPrompt: [
    "You determine prerequisite dependencies ACROSS ALL domains of a learning goal's roadmap — not just within",
    "one domain. A topic in one domain (e.g. \"Programming\") can genuinely require a topic from a different",
    "domain (e.g. \"Math\") first — that's the whole point of this step; look for those cross-domain edges",
    "specifically, not just the obvious within-domain ones.",
    "",
    "For each topic, list the tempIds of OTHER topics (from ANY domain) that must genuinely be learned first —",
    "only real, substantive prerequisites (this topic's content assumes/builds on the other), never invented",
    "structure. Most topics will have some dependencies; topics with none are fine (foundational entry points)",
    "— those become immediately available, and any set of topics with no dependency between them can be",
    "learned in any order relative to each other (in parallel).",
    "",
    "Respond with ONLY a JSON object of this exact shape — no prose, no markdown code fences:",
    '{"dependencies": [{"topicTempId": string, "dependsOnTempIds": string[]}]}',
    "Every topic tempId given to you must appear exactly once — use an empty array for a topic with no",
    "prerequisites among the given topics. Never list a topic as its own dependency.",
  ].join("\n"),
  buildUserPrompt: (context) => {
    const lines = [`Goal: "${context.goalDescription}"`, "", "Topics (grouped by domain):"];
    const byDomain = new Map<string, CrossDomainTopicRef[]>();
    for (const t of context.topics) {
      const list = byDomain.get(t.domainTempId) ?? [];
      list.push(t);
      byDomain.set(t.domainTempId, list);
    }
    for (const [, topics] of byDomain) {
      lines.push(`\nDomain: ${topics[0]!.domainName}`);
      for (const t of topics) {
        lines.push(`  - tempId: ${t.tempId} | ${t.topicName}: ${t.description}`);
      }
    }
    return lines.join("\n");
  },
  outputSchema: DetermineCrossDomainDependenciesOutputSchema,
  maxTokens: 4096,
  effort: "high",
  thinking: true,
});
