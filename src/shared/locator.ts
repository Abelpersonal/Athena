/**
 * A citation's optional, additive anchor into non-article source material — a PDF page number or
 * a video timestamp. Defined here (not in `orchestrator/templates/extractGroundedKeyPoints.ts` or
 * `extraction/fetchAndClean.ts`) so both can depend on the same plain shape without either owning
 * it: `extraction/` stays a standalone module with no orchestrator dependency (its own documented
 * design), and the Zod schema in `extractGroundedKeyPoints.ts` is written to match this type
 * exactly, not the other way around. Optional everywhere it appears — an article source has none
 * of this, exactly like today, before this addition existed at all.
 */
export type Locator = { type: "page"; value: number } | { type: "timestamp"; value: string };
