import type { MetadataRoute } from "next";

/**
 * Phase 10, Deliverable 1: the App Router's native manifest convention — a plain function under
 * `app/`, no `public/manifest.json` needed. Colors/icons match Phase 7's existing dark-mode-
 * default design system (`app/globals.css`'s `--color-bg`/`--color-accent`) rather than picking
 * new ones. `display: "standalone"` is also what Deliverable 2's background-audio fix depends on
 * — a standalone-launched PWA is a persistent top-level browsing context, not a backgroundable
 * browser tab, which is the actual gap Phase 7.5's README flagged.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Athena",
    short_name: "Athena",
    description: "A personal AI learning platform.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0e12",
    theme_color: "#0b0e12",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
