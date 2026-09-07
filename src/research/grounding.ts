import type { ValidateExtraResult } from "../orchestrator/index.js";
import type { Locator } from "../shared/locator.js";

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

/** Parses a natural-format video timestamp ("4:32", "1:04:32") into whole seconds. Returns null for anything that doesn't look like one — never guesses at a value that isn't really there. */
function parseTimestampToSeconds(timestamp: string): number | null {
  const parts = timestamp.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.map(Number).reduce((acc, n) => acc * 60 + n, 0);
}

export interface LocatorSanityInput {
  source_id: string;
  locator?: Locator;
}

/**
 * Soft, warn-only sanity check for the optional `locator` metadata (src/shared/locator.ts) — logs
 * a warning when a cited page number exceeds a source's known real page count, or a cited
 * timestamp exceeds a video's known real duration. Deliberately NOT a `ValidateExtraResult` and
 * never wired into the orchestrator's retry path: a wrong locator is a minor metadata quality
 * issue, not a grounding failure. The hard gate remains exactly `createCitationValidator`'s
 * source_id check above, which this function never touches, weakens, or duplicates.
 */
export function checkLocatorSanity(
  keyPoints: readonly LocatorSanityInput[],
  maxLocatorValueBySourceId: ReadonlyMap<string, number>
): void {
  for (const kp of keyPoints) {
    if (!kp.locator) continue;
    const bound = maxLocatorValueBySourceId.get(kp.source_id);
    if (bound === undefined) continue;

    if (kp.locator.type === "page") {
      if (kp.locator.value > bound) {
        console.warn(
          `[grounding] Key point cites page ${kp.locator.value} of source ${kp.source_id}, which only has ${bound} known page(s) — locator may be fabricated.`
        );
      }
      continue;
    }

    const seconds = parseTimestampToSeconds(kp.locator.value);
    if (seconds === null) {
      console.warn(`[grounding] Key point cites an unparseable timestamp "${kp.locator.value}" for source ${kp.source_id}.`);
      continue;
    }
    if (seconds > bound) {
      console.warn(
        `[grounding] Key point cites timestamp ${kp.locator.value} (${seconds}s) of source ${kp.source_id}, which is only ${bound}s long — locator may be fabricated.`
      );
    }
  }
}
