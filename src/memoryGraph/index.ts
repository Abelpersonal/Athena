import { GraphitiMCPClient } from "./graphitiClient.js";
import type {
  GraphitiNodeResult,
  GraphitiFactResult,
  GraphitiEpisodeResult,
  GraphitiNodeSearchResponse,
  GraphitiFactSearchResponse,
  GraphitiEpisodeSearchResponse,
} from "./types.js";
import type { ExtractGroundedKeyPointsOutput } from "../orchestrator/templates/extractGroundedKeyPoints.js";

export type { GraphitiNodeResult, GraphitiFactResult, GraphitiEpisodeResult } from "./types.js";
export { GraphitiMCPClient } from "./graphitiClient.js";

export type GroundedKeyPoint = ExtractGroundedKeyPointsOutput["keyPoints"][number];

export interface TopicHistoryResult {
  nodes: GraphitiNodeResult[];
  facts: GraphitiFactResult[];
  episodes: GraphitiEpisodeResult[];
  /** Set when the graph couldn't be reached or a call failed — nodes/facts/episodes are empty in that case, not partial. */
  error?: string;
}

const MAX_HISTORY_RESULTS = 20;

/**
 * The Memory Graph client (Phase 3.5). This is the only module that touches
 * Graphiti's MCP protocol directly — the same "one gateway" pattern as the
 * Orchestrator for LLM calls and SearchProvider for web search. Every write
 * here degrades sensibly on failure (logs loudly, then returns normally) —
 * the graph is currently a side effect of course generation, not something
 * course generation depends on succeeding.
 */

let defaultClient: GraphitiMCPClient | null = null;
function getDefaultClient(): GraphitiMCPClient {
  if (!defaultClient) defaultClient = new GraphitiMCPClient();
  return defaultClient;
}

/**
 * Creates/updates a topic node and its prerequisite edges. Replaces Phase
 * 3's `memoryGraph.writeTopic()` stub exactly at its Course Builder call
 * site — the only change is the added `topic` parameter and a real
 * implementation.
 *
 * Two Graphiti primitives are combined deliberately: `add_memory` (an
 * episode) always runs first so a Topic entity gets created via Graphiti's
 * own extraction even when there are zero prerequisites (a `add_triplet`
 * call needs two named endpoints, so it can't create a bare node on its
 * own); then one `add_triplet` per prerequisite writes a precise,
 * synchronous, immediately-queryable REQUIRES_PREREQUISITE edge, rather
 * than hoping the model infers the same relationship from prose.
 */
export async function writeTopic(
  courseId: string,
  topic: string,
  prerequisites: string[],
  client: GraphitiMCPClient = getDefaultClient()
): Promise<void> {
  try {
    await client.callTool("add_memory", {
      name: `Course: ${topic}`,
      episode_body:
        prerequisites.length > 0
          ? `The course "${topic}" was built (course_id: ${courseId}). Prerequisites: ${prerequisites.join(", ")}.`
          : `The course "${topic}" was built (course_id: ${courseId}) with no external prerequisites.`,
      source: "text",
      source_description: `Teacher Course Builder (course_id: ${courseId})`,
      reference_time: new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      `[memory-graph] Failed to write topic episode for "${topic}" (course_id: ${courseId}): ${(error as Error).message}`
    );
  }

  for (const prerequisite of prerequisites) {
    try {
      await client.callTool("add_triplet", {
        source_node_name: topic,
        edge_name: "REQUIRES_PREREQUISITE",
        fact: `"${topic}" requires prior knowledge of "${prerequisite}".`,
        target_node_name: prerequisite,
      });
    } catch (error) {
      console.error(
        `[memory-graph] Failed to write prerequisite edge "${topic}" -> "${prerequisite}" (course_id: ${courseId}): ${(error as Error).message}`
      );
    }
  }
}

/**
 * Writes Phase 2's grounded key points (step 2d's `extract_grounded_key_points`
 * output — atomic, source_id-tagged points, not the paragraph-length
 * synthesized prose from step 2g) as one dated episodic fact per point, tied
 * to the subtopic. Deliberately one `add_memory` call per point rather than
 * one call for the whole batch: Phase 6's Knowledge Update Agent needs to
 * diff and supersede individual facts later, which is only possible if each
 * one is its own episode with its own uuid.
 */
export async function writeSubtopicFacts(
  courseId: string,
  subtopicId: string,
  keyPoints: GroundedKeyPoint[],
  client: GraphitiMCPClient = getDefaultClient()
): Promise<void> {
  if (keyPoints.length === 0) return;

  const referenceTime = new Date().toISOString();
  for (const keyPoint of keyPoints) {
    try {
      await client.callTool("add_memory", {
        name: `Fact: ${subtopicId}`,
        episode_body: JSON.stringify({ point: keyPoint.point, source_id: keyPoint.source_id }),
        source: "json",
        source_description: `Teacher Research Agent (course_id: ${courseId}, subtopic_id: ${subtopicId}, source_id: ${keyPoint.source_id})`,
        reference_time: referenceTime,
      });
    } catch (error) {
      console.error(
        `[memory-graph] Failed to write a fact for subtopic "${subtopicId}" (course_id: ${courseId}): ${(error as Error).message}`
      );
    }
  }
}

/**
 * Read path: returns whatever's currently stored for a topic — the nodes
 * and facts a text search for the topic surfaces, plus recent episodes
 * (unfiltered by topic, since get_episodes only supports group-scoped
 * listing upstream). Used for manual verification now (`inspect-graph`);
 * Phase 5's overlap detection and Phase 6's delta detection build on this
 * same read path later. Never throws — a connection failure comes back as
 * `{ nodes: [], facts: [], episodes: [], error }`, not a rejected promise.
 */
export async function getTopicHistory(
  topic: string,
  client: GraphitiMCPClient = getDefaultClient()
): Promise<TopicHistoryResult> {
  try {
    const [nodeResult, factResult, episodeResult] = await Promise.all([
      client.callTool<GraphitiNodeSearchResponse>("search_nodes", { query: topic, max_nodes: MAX_HISTORY_RESULTS }),
      client.callTool<GraphitiFactSearchResponse>("search_memory_facts", {
        query: topic,
        max_facts: MAX_HISTORY_RESULTS,
      }),
      client.callTool<GraphitiEpisodeSearchResponse>("get_episodes", { max_episodes: MAX_HISTORY_RESULTS }),
    ]);
    return { nodes: nodeResult.nodes, facts: factResult.facts, episodes: episodeResult.episodes };
  } catch (error) {
    const message = (error as Error).message;
    console.error(`[memory-graph] getTopicHistory("${topic}") failed: ${message}`);
    return { nodes: [], facts: [], episodes: [], error: message };
  }
}

/**
 * Phase 4: mirrors a MasteryState update (SQLite is the queryable
 * current-state table — see src/db/schema.ts) into the Memory Graph as a new
 * DATED FACT, never an overwrite. Every call is its own `add_memory` episode
 * (same "one episode per atomic fact" reasoning as writeSubtopicFacts), so
 * the graph accumulates a real history of how a concept node's score changed
 * over time — exactly the temporal, cross-cutting data Phase 3.5 stood up
 * the graph for, and what Phase 5's overlap detection will read.
 */
export async function writeMasteryUpdate(
  conceptNodeId: string,
  scoreType: "knowledge" | "experience",
  score: number,
  detail: string,
  client: GraphitiMCPClient = getDefaultClient()
): Promise<void> {
  try {
    await client.callTool("add_memory", {
      name: `Mastery: ${conceptNodeId} (${scoreType})`,
      episode_body: `${scoreType === "knowledge" ? "Knowledge" : "Experience"} score for concept node "${conceptNodeId}" updated to ${score.toFixed(2)}. ${detail}`,
      source: "text",
      source_description: `Teacher ${scoreType === "knowledge" ? "Quiz" : "Practice"} Engine (concept_node_id: ${conceptNodeId})`,
      reference_time: new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      `[memory-graph] Failed to write ${scoreType} mastery update for "${conceptNodeId}": ${(error as Error).message}`
    );
  }
}

/** Closes the default client's MCP connection (call before process exit). */
export async function closeMemoryGraph(): Promise<void> {
  if (defaultClient) {
    await defaultClient.close();
    defaultClient = null;
  }
}
