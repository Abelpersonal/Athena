"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Phase 11, Deliverable 1: the route-level error boundary — catches a thrown exception anywhere
 * under the root layout (a failed DB read, an unhandled Orchestrator failure that wasn't already
 * wrapped in try/catch upstream, etc.) and renders it in this app's own dark-mode design system
 * instead of Next's unstyled default. Client component per Next's own requirement for error.tsx.
 * `reset()` re-renders the segment — meaningful here since most real failures (a transient DB
 * lock, a network blip) are genuinely retryable, not permanent.
 */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="space-y-4" role="alert">
      <h1 className="text-xl font-medium text-[var(--color-danger)]">Something went wrong</h1>
      <p className="text-sm text-[var(--color-text-muted)]">
        {error.message || "An unexpected error occurred."}
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="min-h-11 rounded-md bg-[var(--color-accent)] text-[#0b0e12] px-4 py-2 font-medium"
        >
          Try again
        </button>
        <Link href="/" className="min-h-11 flex items-center text-sm underline text-[var(--color-text-muted)]">
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
