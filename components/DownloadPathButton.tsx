"use client";

import { useState } from "react";
import { downloadCourse } from "../lib/offline/download.js";

/** An entire path's courses, downloaded one at a time (Path view) — reuses the exact same per-course download as `DownloadCourseButton`, just looped, not a second download mechanism. */
export function DownloadPathButton({ courseIds }: { courseIds: string[] }) {
  const [status, setStatus] = useState<"idle" | "downloading" | "done" | "error">("idle");
  const [progress, setProgress] = useState<string | null>(null);

  async function start() {
    setStatus("downloading");
    try {
      for (let i = 0; i < courseIds.length; i++) {
        setProgress(`Course ${i + 1}/${courseIds.length}...`);
        await downloadCourse(courseIds[i]!, (message) => setProgress(`Course ${i + 1}/${courseIds.length}: ${message}`));
      }
      setStatus("done");
    } catch (e) {
      setProgress(e instanceof Error ? e.message : "Something went wrong.");
      setStatus("error");
    }
  }

  if (courseIds.length === 0) return null;

  if (status === "done") {
    return <p className="text-sm text-[var(--color-accent)]">All {courseIds.length} course(s) downloaded for offline.</p>;
  }

  return (
    <div className="space-y-1">
      <button
        onClick={start}
        disabled={status === "downloading"}
        aria-busy={status === "downloading"}
        className="min-h-11 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm hover:border-[var(--color-accent)] disabled:opacity-50"
      >
        {status === "downloading" ? "Downloading…" : `Download all ${courseIds.length} course(s) for offline`}
      </button>
      {progress && (
        <p
          role={status === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`text-xs ${status === "error" ? "text-[var(--color-danger)]" : "text-[var(--color-text-faint)]"}`}
        >
          {progress}
        </p>
      )}
    </div>
  );
}
