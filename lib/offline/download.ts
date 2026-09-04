import { saveCourseBundle } from "./db.js";
import type { CourseDownloadBundle } from "./types.js";

/**
 * The real "Download for offline" action (Deliverable 3), shared by both `DownloadCourseButton`
 * (Course view) and `DownloadPathButton` (Path view — "an entire path's courses" per the kickoff,
 * which just calls this once per course). Fetches the real bundle, writes it to IndexedDB, then
 * asks the service worker to pre-cache the course's real page responses too (Course/Lesson/Quiz
 * screens) so a page never-before-visited still renders offline — not just its underlying data.
 */
export async function downloadCourse(courseId: string, onProgress?: (message: string) => void): Promise<void> {
  onProgress?.("Fetching course content...");
  const res = await fetch(`/api/courses/${courseId}/download`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? "Failed to download this course.");
  }
  const bundle = (await res.json()) as CourseDownloadBundle;

  await saveCourseBundle(bundle, onProgress);

  if ("serviceWorker" in navigator) {
    const reg = await navigator.serviceWorker.ready;
    reg.active?.postMessage({ type: "CACHE_URLS", urls: bundle.pageUrls });
  }
}
