/**
 * Startup Validation addition: the Next.js server's own one-time-per-process hook (stable since
 * Next 15, no `experimental.instrumentationHook` flag needed) — `register()` runs once when a new
 * server instance boots, before it serves any request. This is a net-new pattern for this
 * codebase: nothing here did eager startup validation before this — every provider (LLM/TTS/push)
 * previously only discovered a missing key lazily, on its first real call, deep inside whatever
 * request triggered it. The root layout (`app/layout.tsx`) was considered instead, but it re-runs
 * on every navigation/request rather than once per server process, which is the wrong shape for a
 * "fail once, loudly, at boot" check — this component-free hook is the officially documented fit.
 *
 * Guarded to the Node.js runtime only: `register()` also runs under the (unused by this app) edge
 * runtime, where `process.env` access and this file's `.js`-suffixed relative import of
 * src/shared/validateEnv wouldn't resolve the same way — every route in this app already pins
 * `export const runtime = "nodejs"` (see e.g. app/api/quiz/[lessonId]/score/route.ts), so this
 * guard costs nothing today but keeps the check from ever silently running twice if that changes.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { validateEnv } = await import("./src/shared/validateEnv.js");
  validateEnv();
}
