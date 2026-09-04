import { decomposeAndPersistPath, runOverlapDetectionForPath, PathPlannerError } from "../../../../src/pathPlanner/index.js";
import { getDb } from "../../../../src/db/client.js";
import { createSseResponse } from "../../_sse.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Thin wrapper over decomposeAndPersistPath -> runOverlapDetectionForPath (the exact chain `npm run harness -- goal` runs for a goal classification). */
export async function GET(request: Request): Promise<Response> {
  const goalDescription = new URL(request.url).searchParams.get("goalDescription")?.trim();
  if (!goalDescription) {
    return new Response(JSON.stringify({ message: "Missing required 'goalDescription' query parameter." }), { status: 400 });
  }

  return createSseResponse(async (send) => {
    const db = await getDb();
    try {
      const persisted = await decomposeAndPersistPath(goalDescription, { db, onProgress: send });
      await runOverlapDetectionForPath(persisted.pathId, { db, onProgress: send });
      return { pathId: persisted.pathId, domainCount: persisted.domainCount, topicCount: persisted.topicCount };
    } catch (error) {
      if (error instanceof PathPlannerError) throw new Error(error.message);
      throw error;
    }
  });
}
