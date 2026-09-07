import { persistDecomposedGoal, runOverlapDetectionForPath, PathPlannerError } from "../../../../src/pathPlanner/index.js";
import { getDb } from "../../../../src/db/client.js";
import { takePendingDecomposition } from "../_pendingDecompositions.js";
import { createSseResponse } from "../../_sse.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Graceful Over-Large-Goal Handling addition: the persist half of what `decompose-stream` used to
 * do in one shot — takes the `decompositionId` `/api/paths/decompose` already stashed (no LLM call
 * happens here) plus the user's chosen `action` ("proceed" persists one Path exactly like the old
 * route always did; "split" persists 2-3 phased Paths — see `persistDecomposedGoal`), then runs
 * overlap detection for every resulting Path before returning, matching what
 * `decompose-stream` always did for its one Path. `action=abort` is never a case here — the client
 * simply never calls this route for that choice, nothing to persist or undo.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const decompositionId = url.searchParams.get("decompositionId");
  const action = url.searchParams.get("action");
  if (!decompositionId || (action !== "proceed" && action !== "split")) {
    return new Response(
      JSON.stringify({ message: "Missing/invalid 'decompositionId' or 'action' (expected 'proceed' or 'split')." }),
      { status: 400 }
    );
  }

  const decomposition = takePendingDecomposition(decompositionId);
  if (!decomposition) {
    return new Response(
      JSON.stringify({ message: "This decomposition has already been used or expired — start over from /new." }),
      { status: 410 }
    );
  }

  return createSseResponse(async (send) => {
    const db = await getDb();
    try {
      const persisted = await persistDecomposedGoal(decomposition, action, { db, onProgress: send });
      for (const p of persisted) {
        await runOverlapDetectionForPath(p.pathId, { db, onProgress: send });
      }
      return { paths: persisted };
    } catch (error) {
      if (error instanceof PathPlannerError) throw new Error(error.message);
      throw error;
    }
  });
}
