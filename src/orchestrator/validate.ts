import type { z } from "zod";

export interface ValidationSuccess<T> {
  success: true;
  data: T;
}
export interface ValidationFailure {
  success: false;
  error: string;
}
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

/** Strips a ```json ... ``` (or bare ```...```) fence if the model wrapped its output in one. */
function extractJsonCandidate(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? raw).trim();
}

/**
 * Parses the model's raw text response as JSON and validates it against the
 * task type's expected schema. This is the "validate response against
 * expected schema/completeness" step of the pipeline.
 */
export function validateResponse<T>(
  schema: z.ZodType<T>,
  raw: string
): ValidationResult<T> {
  const candidate = extractJsonCandidate(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    return {
      success: false,
      error: `Response was not valid JSON: ${(error as Error).message}`,
    };
  }

  const result = schema.safeParse(parsed);
  if (result.success) {
    return { success: true, data: result.data };
  }

  const issues = result.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return { success: false, error: `Response did not match expected schema: ${issues}` };
}

/**
 * Builds the retry prompt: the original request plus a concise correction
 * note describing what was wrong with the previous attempt.
 */
export function buildRetryPrompt(
  originalPrompt: string,
  previousRaw: string,
  errorNote: string
): string {
  return [
    originalPrompt,
    "",
    "--- CORRECTION NEEDED ---",
    "Your previous response did not satisfy the requirements:",
    errorNote,
    "",
    "Your previous response was:",
    previousRaw,
    "",
    "Please respond again, correcting the issue above. Respond with ONLY the JSON object — no prose, no markdown code fences.",
  ].join("\n");
}
