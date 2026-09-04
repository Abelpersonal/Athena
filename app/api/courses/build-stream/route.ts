import { runResearchPipeline, ResearchPipelineError } from "../../../../src/research/pipeline.js";
import { buildCourse, CourseBuilderError } from "../../../../src/courseBuilder/index.js";
import { aggregateMaterials } from "../../../../src/materialAggregator/index.js";
import { getDb } from "../../../../src/db/client.js";
import { createSseResponse } from "../../_sse.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin wrapper over the exact chain `npm run harness -- build` already runs
 * (runResearchPipeline -> buildCourse -> aggregateMaterials) — no logic beyond parsing the query
 * string, calling those three functions with their existing onProgress hook wired to the SSE
 * stream, and shaping the final result as the "done" event's payload.
 */
export async function GET(request: Request): Promise<Response> {
  const topic = new URL(request.url).searchParams.get("topic")?.trim();
  if (!topic) {
    return new Response(JSON.stringify({ message: "Missing required 'topic' query parameter." }), { status: 400 });
  }

  return createSseResponse(async (send) => {
    const db = await getDb();
    try {
      const course = await runResearchPipeline(topic, { onProgress: send });
      const built = await buildCourse(course, { db, onProgress: send });
      const aggregated = await aggregateMaterials(built.courseId, course, built.subtopicLessonMap, { db, onProgress: send });
      return {
        courseId: built.courseId,
        moduleCount: built.moduleCount,
        lessonCount: built.lessonCount,
        sourceCount: aggregated.sourceCount,
      };
    } catch (error) {
      if (error instanceof ResearchPipelineError || error instanceof CourseBuilderError) {
        throw new Error(error.message);
      }
      throw error;
    }
  });
}
