"use client";

import { useEffect, useState } from "react";
import { listDownloadedCourses, removeDownloadedCourse } from "../lib/offline/db.js";
import type { DownloadedCourseSummary } from "../lib/offline/types.js";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Phase 10, Deliverable 3's storage management UI — real IndexedDB reads, real removal, real size accounting (not an estimate re-derived from navigator.storage.estimate(), which reports the whole origin's usage, not per-course). */
export function DownloadsManager() {
  const [courses, setCourses] = useState<DownloadedCourseSummary[] | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function refresh() {
    setCourses(await listDownloadedCourses());
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function remove(courseId: string) {
    setRemovingId(courseId);
    try {
      await removeDownloadedCourse(courseId);
      await refresh();
    } finally {
      setRemovingId(null);
    }
  }

  if (courses === null) return <p className="text-sm text-[var(--color-text-faint)]">Loading…</p>;

  if (courses.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">Nothing downloaded yet — use "Download for offline" from a course or path.</p>;
  }

  const totalBytes = courses.reduce((sum, c) => sum + c.sizeBytes, 0);

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-text-muted)]">{courses.length} course(s) downloaded · {formatBytes(totalBytes)} total</p>
      <ul className="space-y-2">
        {courses.map((c) => (
          <li key={c.courseId} className="rounded-lg border border-[var(--color-border)] p-3 flex items-center justify-between gap-3">
            <div>
              <p>{c.topic}</p>
              <p className="text-xs text-[var(--color-text-faint)]">
                {formatBytes(c.sizeBytes)} · {c.lessonIds.length} lesson(s) · downloaded {new Date(c.downloadedAt).toLocaleDateString()}
              </p>
            </div>
            <button
              onClick={() => void remove(c.courseId)}
              disabled={removingId === c.courseId}
              className="text-sm px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:border-[var(--color-danger)] disabled:opacity-50"
            >
              {removingId === c.courseId ? "Removing…" : "Remove"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
