/**
 * Rough per-token pricing for cost estimation in the JSONL log. This does not
 * need to be exact (per the Phase 1 spec) — it exists so cost is visible at
 * all, not to reconcile against an invoice. Update this table when adding a
 * new ORCHESTRATOR_MODEL or when Anthropic publishes new pricing.
 *
 * Prices are USD per 1M tokens, current as of this project's Phase 1 build.
 */
export const PRICING_USD_PER_MILLION_TOKENS: Record<
  string,
  { input: number; output: number }
> = {
  "claude-fable-5": { input: 10.0, output: 50.0 },
  "claude-mythos-5": { input: 10.0, output: 50.0 },
  "claude-opus-5": { input: 5.0, output: 25.0 },
  "claude-opus-4-8": { input: 5.0, output: 25.0 },
  "claude-opus-4-7": { input: 5.0, output: 25.0 },
  "claude-opus-4-6": { input: 5.0, output: 25.0 },
  "claude-sonnet-5": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  // Gemini — introductory rates (through 2026-12-31); pro-tier rates are the
  // <=200k-token-prompt tier (this project's prompts are always well under that).
  "gemini-3.7-flash": { input: 0.75, output: 3.75 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-pro": { input: 1.25, output: 10.0 },
  "gemini-3.1-pro-preview": { input: 2.0, output: 12.0 },
};

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  providerName?: string
): number {
  // Ollama is local inference — there is no per-token API cost, ever, regardless of which model
  // name the operator has pulled. Checked by PROVIDER, not by trying to enumerate Ollama model
  // names into the table above: unlike Claude/Gemini's fixed, versioned catalog, an Ollama
  // install's models are an open-ended, user-controlled set ("llama3.2", "qwen2.5:14b", a custom
  // finetune, anything `ollama pull` has ever fetched) — hardcoding a few common names would just
  // reproduce the exact "unrecognized model" warning below for every name not on that
  // impossible-to-complete list. Returns $0 silently, no warning — $0 is the correct, INTENDED
  // cost here, not a gap in this table, which is exactly the distinction this check exists to make
  // visible in the logs (a real "no pricing data" warning still fires for a genuinely unrecognized
  // hosted-provider model name, below).
  if (providerName === "ollama") return 0;

  const pricing = PRICING_USD_PER_MILLION_TOKENS[model];
  if (!pricing) {
    console.warn(
      `[orchestrator] No pricing data for model "${model}" — cost estimate will be 0. Add an entry to src/orchestrator/pricing.ts.`
    );
    return 0;
  }
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output
  );
}
