"use client";

import { useEffect, useState } from "react";

export interface ProgressStreamState<T> {
  lines: string[];
  result: T | null;
  error: string | null;
  finished: boolean;
}

/**
 * Connects to one of the SSE routes (app/api/_sse.ts's framing: "progress"/"done"/"failed" named
 * events) and returns the live progress log plus the final result/error. `url` is null until the
 * caller is ready to start (e.g. after the user confirms the classify step) — the effect only
 * opens a connection once a real url is provided.
 */
export function useProgressStream<T>(url: string | null): ProgressStreamState<T> {
  const [lines, setLines] = useState<string[]>([]);
  const [result, setResult] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (!url) return;
    setLines([]);
    setResult(null);
    setError(null);
    setFinished(false);

    const source = new EventSource(url);

    source.addEventListener("progress", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { message: string };
      setLines((prev) => [...prev, data.message]);
    });
    source.addEventListener("done", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as T;
      setResult(data);
      setFinished(true);
      source.close();
    });
    source.addEventListener("failed", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { message: string };
      setError(data.message);
      setFinished(true);
      source.close();
    });
    source.onerror = () => {
      // A genuine connection-level failure (network down, server process died) rather than our
      // own "failed" event — only report it if we haven't already finished normally.
      setFinished((alreadyFinished) => {
        if (!alreadyFinished) setError((prev) => prev ?? "Connection lost while generating.");
        return true;
      });
      source.close();
    };

    return () => source.close();
  }, [url]);

  return { lines, result, error, finished };
}

/** The live progress log itself — a plain scrolling list, matching §6.1's "communicate progress, not a spinner with no information." */
export function ProgressLog({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <ul className="text-sm text-[var(--color-text-muted)] font-mono space-y-0.5 max-h-64 overflow-y-auto border border-[var(--color-border)] rounded-lg p-3 bg-[var(--color-surface)]">
      {lines.map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ul>
  );
}
