import type { NextConfig } from "next";
import type { Configuration } from "webpack";

/**
 * Deliberately pinned to webpack, not Turbopack (Next 16's new default) — documented here and in
 * the README's "Bundler: webpack, not Turbopack" section. `src/`'s existing, verified-across-6-
 * phases code uses NodeNext module resolution, which requires every relative import to carry an
 * explicit `.js` extension even though the real file is `.ts` (standard Node ESM + TypeScript
 * convention — see tsconfig.backend.json). Turbopack has no equivalent to webpack's
 * `resolve.extensionAlias` yet (confirmed: this is a currently-open, unresolved gap —
 * github.com/vercel/next.js/issues/82945, "support importing .ts/.tsx via .js extension, parity
 * with webpack resolve.extensionAlias") — every route/Server Component that imports from `src/`
 * fails to bundle under Turbopack as a result. Rewriting `src/`'s own internal imports to drop
 * their `.js` extensions was rejected: it would mean changing a verified, tested-across-6-phases
 * module resolution convention (tsx/vitest/tsc all depend on it) purely to satisfy the frontend
 * bundler, exactly the kind of "rework a verified phase for a UI need" the kickoff prompt warns
 * against. webpack's `resolve.extensionAlias` is a first-party, stable Next.js/webpack mechanism
 * (no third-party patch package) that solves this with zero changes to `src/`.
 */
const nextConfig: NextConfig = {
  /**
   * `serverExternalPackages`: keep these out of the bundle rather than letting it try to
   * trace/bundle them — @modelcontextprotocol/sdk spawns child processes (stdio MCP transports,
   * src/mcp/*.ts) and jsdom is a large, non-trivial-to-bundle DOM implementation
   * (src/extraction/fetchAndClean.ts). `pdf-parse` (Source Diversity phase) was missing from this
   * list — a real, discovered gap: `next dev --webpack` crashed with "Object.defineProperty called
   * on non-object" while bundling `src/extraction/fetchAndCleanPdf.ts` for the RSC graph on ANY
   * page that transitively imports it (e.g. `/` -> knowledgeUpdate -> extraction/fetchAndClean),
   * even though `next build`/`next start` (production) never hit it — the exact same "large/
   * non-trivial-to-bundle" reasoning `jsdom` already gets here, just missed when `pdf-parse` was
   * added. node:sqlite is a Node builtin, not a package, so it needs no entry here — every route
   * that reaches into src/ runs in the default Node.js runtime (never "edge"), which all of these —
   * and node:sqlite — require.
   */
  serverExternalPackages: ["@modelcontextprotocol/sdk", "jsdom", "pdf-parse"],
  webpack: (config: Configuration) => {
    config.resolve = {
      ...config.resolve,
      extensionAlias: { ".js": [".ts", ".tsx", ".js"] },
    };
    return config;
  },
};

export default nextConfig;
