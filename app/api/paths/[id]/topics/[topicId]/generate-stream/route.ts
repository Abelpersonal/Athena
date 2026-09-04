import { generateTopicCourse, PathPlannerError } from "../../../../../../../src/pathPlanner/index.js";
import { ResearchPipelineError } from "../../../../../../../src/research/pipeline.js";
import { CourseBuilderError } from "../../../../../../../src/courseBuilder/index.js";
import { getDb } from "../../../../../../../src/db/client.js";
import { createSseResponse } from "../../../../../_sse.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin wrapper over generateTopicCourse() — the [id] path segment isn't used by the call itself
 * (generateTopicCourse resolves the path/domain from the PathTopic row directly), but it's kept in
 * the URL for a RESTful, path-scoped route shape matching the Path view's own /paths/:id context.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; topicId: string }> }
): Promise<Response> {
  const { topicId } = await params;

  return createSseResponse(async (send) => {
    const db = await getDb();
    try {
      const result = await generateTopicCourse(topicId, { db, onProgress: send });
      return result;
    } catch (error) {
      if (error instanceof PathPlannerError || error instanceof ResearchPipelineError || error instanceof CourseBuilderError) {
        throw new Error(error.message);
      }
      throw error;
    }
  });
}
