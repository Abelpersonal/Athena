"use client";

import { useEffect } from "react";

/**
 * Phase 11, Deliverable 1: the ONE boundary that catches an error thrown in the root layout
 * itself (`app/layout.tsx`) — Next requires this to render its own complete `<html>`/`<body>`,
 * since a root-layout failure means the real layout never mounted at all. Deliberately minimal
 * (inline styles, no Tailwind/globals.css dependency) since the very thing that might be broken
 * is app-wide setup — this must render even if that's the case.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ background: "#0b0e12", color: "#e6e9ee", fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
        <h1 style={{ color: "#e0768a", fontSize: "1.25rem", fontWeight: 500 }}>Athena hit an unexpected error</h1>
        <p style={{ color: "#8b93a1", fontSize: "0.875rem", marginTop: "0.5rem" }}>
          {error.message || "The app failed to load."}
        </p>
        <button
          onClick={reset}
          style={{
            marginTop: "1rem",
            minHeight: "44px",
            borderRadius: "6px",
            background: "#7dd3c0",
            color: "#0b0e12",
            padding: "0.5rem 1rem",
            fontWeight: 500,
            border: "none",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
