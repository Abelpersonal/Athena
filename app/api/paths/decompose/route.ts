import { decomposeGoal, PathPlannerError } from "../../../../src/pathPlanner/index.js";
import { stashPendingDecomposition } from "../_pendingDecompositions.js";

export const runtime = "nodejs";

/**
 * Graceful Over-Large-Goal Handling addition: the decompose-only half of what
 * `decompose-stream` used to do in one shot. A quick, non-streamed request (two [LLM] calls, not
 * the multi-minute research pipeline) so the client can inspect the result BEFORE anything is
 * persisted — mirroring `/api/classify`'s own "decide before acting" shape. Normal-sized
 * decompositions get a `decompositionId` too (not just oversized ones) so the client always hands
 * the SAME kind of id to `/api/paths/persist-stream` regardless of outcome, rather than needing two
 * different follow-up shapes.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as { goalDescription?: string };
  const goalDescription = body.goalDescription?.trim();
  if (!goalDescription) {
    return Response.json({ message: "Missing required 'goalDescription' field." }, { status: 400 });
  }

  try {
    const decomposition = await decomposeGoal(goalDescription);
    const decompositionId = stashPendingDecomposition(decomposition);
    return Response.json({
      outcome: decomposition.outcome,
      decompositionId,
      topicCount: decomposition.topicCount,
      hardLimit: decomposition.hardLimit,
      domainBreakdown: decomposition.domainBreakdown,
    });
  } catch (error) {
    if (error instanceof PathPlannerError) {
      return Response.json({ message: error.message }, { status: 422 });
    }
    throw error;
  }
}
