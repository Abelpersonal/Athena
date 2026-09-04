import type { CourseLessonLayers, MindMapGraph } from "../../src/db/schema.js";
import type { QuizQuestion } from "../../src/quizEngine/index.js";

/**
 * Phase 10, Deliverable 3: the shape `GET /api/courses/:id/download` returns, and what
 * `lib/offline/db.ts` writes into IndexedDB. Deliberately mirrors the relevant slice of
 * `src/db/schema.ts`'s real server-side tables (courses/modules/lessons/mindMaps) rather than a
 * redesigned offline-only shape — the offline store is a genuine cache of server data, not a
 * parallel model that can drift from it (per the kickoff's own explicit instruction).
 */

export interface OfflineCourse {
  id: string;
  topic: string;
}

export interface OfflineModule {
  id: string;
  courseId: string;
  title: string;
  description: string;
  order: number;
}

export interface OfflineLesson {
  id: string;
  moduleId: string;
  courseId: string;
  title: string;
  description: string;
  estimatedDuration: string;
  layers: CourseLessonLayers;
  sourceRefs: string[];
}

export interface OfflineQuizQuestions {
  lessonId: string;
  questions: QuizQuestion[];
}

export interface OfflineMindMap {
  courseId: string;
  graph: MindMapGraph;
}

/** One already-cached (Phase 7.5) TTS audio chunk's real URL — never a chunk that would need synthesizing on download, per the kickoff's explicit "download the cached files, don't regenerate." */
export interface OfflineAudioChunkRef {
  url: string;
  lessonId: string;
}

export interface CourseDownloadBundle {
  course: OfflineCourse;
  modules: OfflineModule[];
  lessons: OfflineLesson[];
  quizQuestions: OfflineQuizQuestions[];
  mindMap: OfflineMindMap | null;
  audioChunks: OfflineAudioChunkRef[];
  /** Page routes to pre-cache via the service worker's Cache API (Course/Lesson/Quiz screens for every lesson in this course) — see components/DownloadCourseButton.tsx. */
  pageUrls: string[];
}

export interface DownloadedCourseSummary {
  courseId: string;
  topic: string;
  downloadedAt: string;
  sizeBytes: number;
  lessonIds: string[];
  /** Real page + audio-chunk URLs the service worker cached for this course (Cache API, not IndexedDB) — kept so removal can tell the SW exactly which cache entries to clear, freeing the space that store actually used. */
  cachedUrls: string[];
}
