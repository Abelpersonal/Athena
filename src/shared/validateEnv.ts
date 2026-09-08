export class EnvValidationError extends Error {}

export interface ValidateEnvOptions {
  /**
   * Skip validation entirely. Every dry-run mode across the harness/knowledge-update/
   * engagement-check CLIs mocks the LLM/search/push collaborators (see e.g.
   * src/harness/cli.ts's own doc comment on `--dry-run`), so none of the real keys this function
   * checks are actually needed for those runs — an already-established, legitimate use case that
   * must not be broken by adding this check.
   */
  skip?: boolean;
}

/**
 * Fails fast, at startup, with one clear, actionable error naming exactly what's missing and
 * which config choice requires it — instead of a real run failing deep inside (a generic 401 from
 * the Gemini SDK three calls into a research pipeline, or `engagementCheck`'s currently-uncaught
 * crash — see README — when VAPID is partially configured and a nudge finally comes due).
 *
 * Deliberately checks only presence/non-emptiness of the values these already-existing runtime
 * paths already depend on — `LLM_PROVIDER`'s selected key (src/orchestrator/providers/index.ts),
 * `TTS_PROVIDER`'s selected key (src/teachingEngine/tts/index.ts), and the three VAPID push
 * variables (src/push/index.ts) — never key *validity* (a malformed key still passes here; only a
 * live API call can catch that), and never a provider name that isn't one of the two known values
 * for either `LLM_PROVIDER`/`TTS_PROVIDER` — `getProvider()`/`getTtsProvider()` already throw a
 * clear error for that lazily, on first real use, and duplicating that check here would just be a
 * second copy of the same validation to keep in sync.
 *
 * `TAVILY_API_KEY` is the one deliberate exception to "fail fast": it only warns, never throws —
 * per the SSRF/idempotency pass's established precedent for optional-but-important config, and
 * because dry-run/mocked workflows are a legitimate, already-established use case that never
 * touches real search at all.
 */
export function validateEnv(options: ValidateEnvOptions = {}): void {
  if (options.skip) return;

  const errors: string[] = [];

  const llmProvider = (process.env.LLM_PROVIDER || "gemini").toLowerCase();
  if (llmProvider === "gemini" && !process.env.GEMINI_API_KEY) {
    errors.push("LLM_PROVIDER=gemini (the default) requires GEMINI_API_KEY to be set.");
  } else if (llmProvider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    errors.push("LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY to be set.");
  }

  const ttsProvider = (process.env.TTS_PROVIDER || "openai").toLowerCase();
  if (ttsProvider === "openai" && !process.env.OPENAI_API_KEY) {
    errors.push("TTS_PROVIDER=openai (the default) requires OPENAI_API_KEY to be set.");
  }

  if (!process.env.TAVILY_API_KEY) {
    console.warn(
      "[validateEnv] TAVILY_API_KEY is not set — real web search will fail once a run reaches a " +
        "search call. Fine for a dry-run/mocked workflow; set it before any real research/build/" +
        "knowledge-update run."
    );
  }

  const vapidVars: Record<string, string | undefined> = {
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
  };
  const vapidSetCount = Object.values(vapidVars).filter((v) => Boolean(v)).length;
  if (vapidSetCount > 0 && vapidSetCount < 3) {
    const missing = Object.entries(vapidVars)
      .filter(([, v]) => !v)
      .map(([name]) => name);
    errors.push(
      `Push notifications are partially configured — ${missing.join(", ")} missing. Set all ` +
        "three of VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT together, or unset all " +
        "three to leave push disabled."
    );
  }

  if (errors.length > 0) {
    throw new EnvValidationError(
      `Environment validation failed — fix before starting:\n${errors.map((e) => `  - ${e}`).join("\n")}`
    );
  }
}
