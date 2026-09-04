import { eq } from "drizzle-orm";
import { getDb } from "../../../../../src/db/client.js";
import { courses, modules, lessons } from "../../../../../src/db/schema.js";
import { getCourseMindMap } from "../../../../../src/db/queries.js";
import { generateQuizQuestions, ALL_QUIZ_TIERS } from "../../../../../src/quizEngine/index.js";
import type { CourseDownloadBundle, OfflineAudioChunkRef } from "../../../../../lib/offline/types.js";

export const runtime = "nodejs";

/**
 * Phase 10, Deliverable 3: the real "Download for offline" bundle. Quiz questions are generated
 * FRESH here (a real `generateQuizQuestions()` call per lesson, all three tiers — the same real
 * LLM cost a learner would incur taking that quiz normally) since there's no persisted
 * question-bank table anywhere in this codebase to read from instead; the kickoff's own
 * instruction is "generate once at download time... cache the OUTPUT" — the caching happens
 * client-side in IndexedDB (lib/offline/db.ts), not as a new server-side table. Audio is NEVER
 * synthesized here — only chunks Phase 7.5's existing per-lesson cache (`lessons.audioCacheRef`)
 * already has are listed, so a course with TTS_PROVIDER=browser (no server audio cache at all) or
 * a lesson whose audio hasn't been generated yet simply downloads with fewer/no audio chunks,
 * never triggering a new TTS API call.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id: courseId } = await params;
  const db = await getDb();

  const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
  if (!course) {
    return Response.json({ message: `No course found with id "${courseId}".` }, { status: 404 });
  }

  const moduleRows = await db.select().from(modules).where(eq(modules.courseId, courseId));
  const lessonRows: (typeof lessons.$inferSelect)[] = [];
  for (const m of moduleRows) {
    lessonRows.push(...(await db.select().from(lessons).where(eq(lessons.moduleId, m.id))));
  }

  const quizQuestions: CourseDownloadBundle["quizQuestions"] = [];
  const audioChunks: OfflineAudioChunkRef[] = [];
  const pageUrls: string[] = [`/courses/${courseId}`];

  for (const lesson of lessonRows) {
    const questions = await generateQuizQuestions(lesson.id, ALL_QUIZ_TIERS);
    quizQuestions.push({ lessonId: lesson.id, questions });

    for (const entry of lesson.audioCacheRef ?? []) {
      audioChunks.push({ lessonId: lesson.id, url: `/api/lessons/${lesson.id}/audio?layer=${entry.layer}&chunkIndex=${entry.chunkIndex}` });
    }

    pageUrls.push(`/lessons/${lesson.id}`, `/quiz/${lesson.id}`);
  }

  const mindMapData = await getCourseMindMap(courseId, { db });

  const bundle: CourseDownloadBundle = {
    course: { id: course.id, topic: course.topic },
    modules: moduleRows.map((m) => ({ id: m.id, courseId: m.courseId, title: m.title, description: m.description, order: m.order })),
    lessons: lessonRows.map((l) => ({
      id: l.id,
      moduleId: l.moduleId,
      courseId,
      title: l.title,
      description: l.description,
      estimatedDuration: l.estimatedDuration,
      layers: l.layers,
      sourceRefs: l.sourceRefs,
    })),
    quizQuestions,
    mindMap: mindMapData.graph ? { courseId, graph: mindMapData.graph } : null,
    audioChunks,
    pageUrls,
  };

  return Response.json(bundle);
}
