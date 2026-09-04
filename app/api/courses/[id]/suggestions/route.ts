import { runContinuousLearningAgent, ContinuousLearningError } from "../../../../../src/continuousLearning/index.js";

export const runtime = "nodejs";

/**
 * Thin wrapper over runContinuousLearningAgent() — the Dashboard's on-demand "Get suggestions"
 * action. Plain request/response, not SSE: a handful of LLM + Open Library/Gutenberg MCP calls,
 * not the multi-minute case the PRD's progress-feedback requirement is about.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;

  try {
    const result = await runContinuousLearningAgent(id);
    return Response.json(result);
  } catch (error) {
    if (error instanceof ContinuousLearningError) {
      return Response.json({ message: error.message }, { status: 400 });
    }
    throw error;
  }
}
