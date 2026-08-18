/**
 * TypeScript mirrors of Graphiti MCP server's real response TypedDicts
 * (mcp_server/src/models/response_types.py, verified against the live
 * getzep/graphiti source — not guessed from docs). Kept minimal: only the
 * shapes this client actually reads.
 */

export interface GraphitiErrorResponse {
  error: string;
}

export interface GraphitiSuccessResponse {
  message: string;
}

export interface GraphitiNodeResult {
  uuid: string;
  name: string;
  labels: string[];
  created_at: string | null;
  summary: string | null;
  group_id: string;
  attributes: Record<string, unknown>;
}

export interface GraphitiNodeSearchResponse {
  message: string;
  nodes: GraphitiNodeResult[];
}

/**
 * search_memory_facts formats each edge via EntityEdge.model_dump(), so the
 * real shape is broader than the EdgeResult TypedDict (it includes
 * "attributes" and other Pydantic fields) — kept loose here rather than
 * over-typing a shape that isn't pinned down as a formal TypedDict upstream.
 */
export interface GraphitiFactResult {
  uuid: string;
  name: string;
  fact: string;
  source_node_uuid: string;
  target_node_uuid: string;
  group_id: string;
  created_at: string | null;
  valid_at: string | null;
  invalid_at: string | null;
  [key: string]: unknown;
}

export interface GraphitiFactSearchResponse {
  message: string;
  facts: GraphitiFactResult[];
}

export interface GraphitiEpisodeResult {
  uuid: string;
  name: string;
  content: string;
  created_at: string | null;
  source: string;
  source_description: string;
  group_id: string;
}

export interface GraphitiEpisodeSearchResponse {
  message: string;
  episodes: GraphitiEpisodeResult[];
}

export interface GraphitiTripletResponse {
  message: string;
  nodes: GraphitiNodeResult[];
  edges: unknown[];
}

export function isErrorResponse(value: unknown): value is GraphitiErrorResponse {
  return !!value && typeof value === "object" && typeof (value as { error?: unknown }).error === "string";
}
