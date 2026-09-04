"use client";

import { useState } from "react";
import { downloadCourse } from "../lib/offline/download.js";

/** One course's real "Download for offline" action (Course view). */
export function DownloadCourseButton({ courseId }: { courseId: string }) {
  const [status, setStatus] = useState<"idle" | "downloading" | "done" | "error">("idle");
  const [progress, setProgress] = useState<string | null>(null);

  async function start() {
    setStatus("downloading");
    setProgress(null);
    try {
      await downloadCourse(courseId, (message) => setProgress(message));
      setStatus("done");
    } catch (e) {
      setProgress(e instanceof Error ? e.message : "Something went wrong.");
      setStatus("error");
    }
  }

  if (status === "done") {
    return <p className="text-sm text-[var(--color-accent)]">Downloaded for offline.</p>;
  }

  return (
    <div className="space-y-1">
      <button
        onClick={start}
        disabled={status === "downloading"}
        className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm hover:border-[var(--color-accent)] disabled:opacity-50"
      >
        {status === "downloading" ? "Downloading…" : "Download for offline"}
      </button>
      {progress && (
        <p className={`text-xs ${status === "error" ? "text-[var(--color-danger)]" : "text-[var(--color-text-faint)]"}`}>{progress}</p>
      )}
    </div>
  );
}
