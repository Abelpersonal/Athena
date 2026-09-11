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
 * live API call can catch that), and never a provider name that isn't one of the three known
 * values for `LLM_PROVIDER` (or the two for `TTS_PROVIDER`) — `getProvider()`/`getTtsProvider()`
 * already throw a clear error for that lazily, on first real use, and duplicating that check here
 * would just be a second copy of the same validation to keep in sync.
 *
 * `LLM_PROVIDER=ollama` is checked differently from the other two: only `OLLAMA_MODEL` is
 * required, never `OLLAMA_BASE_URL` — Ollama is a local endpoint, not a hosted API, so there's no
 * key to be missing, and `OLLAMA_BASE_URL` has a genuinely working default
 * (`http://localhost:11434`, the standard local Ollama port) the same way `GRAPHITI_MCP_URL` does
 * and is never checked here either. `OLLAMA_MODEL` has no such default — unlike Claude/Gemini's
 * fixed model catalog, it depends entirely on what the operator has actually pulled locally, so
 * guessing one would be worse than requiring it explicitly.
 *
 * `TAVILY_API_KEY` is the one deliberate exception to "fail fast": it only warns, never throws —
 * not because it's optional-but-broken-without-it, but because it genuinely isn't required at all.
 * The real `tavily-mcp` server (confirmed directly by reading its own source, not guessed —
 * `npm pack tavily-mcp` and inspect `build/index.js`) transparently supports Tavily's free,
 * rate-limited **keyless** access mode when no key is set: search and extract (the only two tools
 * this codebase calls) both work, just capped at a lower request rate than a real key gets. This
 * warning exists purely so an operator knows which mode they're in, not because anything is
 * expected to fail.
 */
export function validateEnv(options: ValidateEnvOptions = {}): void {
  if (options.skip) return;

  const errors: string[] = [];

  const llmProvider = (process.env.LLM_PROVIDER || "gemini").toLowerCase();
  if (llmProvider === "gemini" && !process.env.GEMINI_API_KEY) {
    errors.push("LLM_PROVIDER=gemini (the default) requires GEMINI_API_KEY to be set.");
  } else if (llmProvider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    errors.push("LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY to be set.");
  } else if (llmProvider === "ollama" && !process.env.OLLAMA_MODEL) {
    errors.push(
      "LLM_PROVIDER=ollama requires OLLAMA_MODEL to be set — there's no sane default since it " +
        "depends entirely on what you've pulled locally (e.g. `ollama pull llama3.2`, then " +
        "OLLAMA_MODEL=llama3.2)."
    );
  }

  const ttsProvider = (process.env.TTS_PROVIDER || "openai").toLowerCase();
  if (ttsProvider === "openai" && !process.env.OPENAI_API_KEY) {
    errors.push("TTS_PROVIDER=openai (the default) requires OPENAI_API_KEY to be set.");
  }

  if (!process.env.TAVILY_API_KEY) {
    console.warn(
      "[validateEnv] TAVILY_API_KEY is not set — real web search will run in Tavily's free, " +
        "rate-limited keyless mode (search + extract only). This is a legitimate, working " +
        "configuration, not a failure; set a real key only if you want a higher rate limit."
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
