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
};

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
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
