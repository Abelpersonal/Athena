"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useProgressStream, ProgressLog } from "./ProgressStream.js";

/** Triggers generateTopicCourse() via SSE for one generatable PathTopic, then refreshes the Server Component (router.refresh()) rather than navigating away — the Path view is where the result should show up, re-annotated. */
export function GenerateTopicButton({ pathId, topicId, topicName }: { pathId: string; topicId: string; topicName: string }) {
  const router = useRouter();
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const stream = useProgressStream<{ courseId: string }>(streamUrl);

  if (stream.finished && stream.result?.courseId && !stream.error) {
    router.refresh();
  }

  if (streamUrl) {
    return (
      <div className="mt-2 space-y-2">
        <p className="text-sm text-[var(--color-text-muted)]">Generating "{topicName}"…</p>
        <ProgressLog lines={stream.lines} />
        {stream.error && <p className="text-[var(--color-danger)] text-sm">{stream.error}</p>}
      </div>
    );
  }

  return (
    <button
      onClick={() => setStreamUrl(`/api/paths/${pathId}/topics/${topicId}/generate-stream`)}
      className="text-sm px-2 py-1 rounded-md border border-[var(--color-border)] hover:border-[var(--color-accent)]"
    >
      Generate
    </button>
  );
}
