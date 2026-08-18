import type { ValidateExtraResult } from "../orchestrator/index.js";

/**
 * Builds an orchestrator `validateExtra` function that fails (triggering the
 * normal retry-with-correction-note path) if the response cites any
 * source_id outside the set actually provided in that call's context. This
 * is the hard grounding NFR: the Orchestrator's static Zod schema can check
 * "source_id is a non-empty string", but only a per-call check like this one
 * can catch "source_id doesn't exist" — the valid set differs every call.
 */
export function createCitationValidator(
  validSourceIds: ReadonlySet<string>,
  extractCitedSourceIds: (data: unknown) => string[]
): (data: unknown) => ValidateExtraResult {
  return (data: unknown): ValidateExtraResult => {
    const cited = extractCitedSourceIds(data);
    const invalid = [...new Set(cited)].filter((id) => !validSourceIds.has(id));
    if (invalid.length > 0) {
      return {
        success: false,
        error:
          `Response cited source_id(s) that were not in the provided material: ${invalid.join(", ")}. ` +
          `Valid source_ids for this call are: ${[...validSourceIds].join(", ")}. ` +
          "Only cite source_ids that were given to you — never invent one.",
      };
    }
    return { success: true };
  };
}
