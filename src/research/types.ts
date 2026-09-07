import type { SynthesizeSubtopicOutput } from "../orchestrator/templates/synthesizeSubtopic.js";
import type { RestructureLayersOutput } from "../orchestrator/templates/restructureLayers.js";
import type { DepthAuditScoreOutput } from "../orchestrator/templates/depthAuditScore.js";
import type { ExtractGroundedKeyPointsOutput } from "../orchestrator/templates/extractGroundedKeyPoints.js";
import type { Locator } from "../shared/locator.js";

/** One page (PDF)/timestamp segment (video) of a `SourceRecord`'s text, carrying the locator that anchors it — mirrors `extraction/fetchAndClean.ts`'s `ContentChunk`, kept as a separate type so `research/` doesn't import from `extraction/` for it. */
export interface SourceChunk {
  text: string;
  locator?: Locator;
}

/** One piece of fetched-and-cleaned source material used to research a subtopic. */
export interface SourceRecord {
  source_id: string;
  url: string;
  title: string;
  text: string;
  extractionConfidence: number;
  domain: string;
  /** The search query that surfaced this source. */
  query: string;
  role: "initial" | "contention";
  publishedDate?: string;
  /** Per-page/per-timestamp-segment breakdown, present only for "pdf"/"video" sources — `pipeline.ts`'s `toSourceExcerpts` fans this out into multiple tagged `SourceExcerpt`s instead of the source's one flat `text` blob. Absent (undefined) for "article" sources, exactly like before this field existed. */
  chunks?: SourceChunk[];
  /** The source's own known real extent (PDF page count / video duration in seconds) — used only by `grounding.ts`'s soft `checkLocatorSanity` check, never for citation validation. */
  maxLocatorValue?: number;
}

export interface AuditPassRecord {
  attempt: number;
  criteria: DepthAuditScoreOutput["criteria"];
  overallPass: boolean;
}

export interface SubtopicResult {
  id: string;
  title: string;
  description: string;
  sources: SourceRecord[];
  /** Step 2d's raw output: atomic, source_id-tagged points — this is what Phase 3.5 writes to the Memory Graph as individually diffable facts, not the paragraph-length `synthesis` prose. */
  keyPoints: ExtractGroundedKeyPointsOutput["keyPoints"];
  synthesis: SynthesizeSubtopicOutput;
  layers: RestructureLayersOutput["layers"];
  auditPasses: AuditPassRecord[];
  /** "shallow_after_retry" means the subtopic still failed its last audit but is shipped anyway (bounded retries). */
  auditStatus: "passed" | "shallow_after_retry";
  volatility: {
    tier: "fast" | "medium" | "slow";
    justification: string;
  };
}

export interface CourseJson {
  topic: string;
  prerequisites: string[];
  subtopics: SubtopicResult[];
  generatedAt: string;
  /** Phase 5: the goal/domain framing this run was biased toward, when runResearchPipeline() was called with a goalContext option — undefined for every standalone Phase 1-4 call. Threaded through to buildCourse() -> courses.goalContext. */
  goalContext?: string;
  /**
   * The result of the decomposition-completeness audit (Coverage Completeness Audit addition) —
   * a SEPARATE check from any per-subtopic `auditStatus` above: this one asks whether the proposed
   * SUBTOPIC LIST itself was missing a whole sub-area, not whether one subtopic's content is deep
   * enough. "gaps_noted_after_retry" means the audit still reported a real gap after one retry
   * (which already appended whatever it found on the first attempt) — the course ships anyway,
   * flagged, rather than looping indefinitely or blocking generation.
   */
  coverageStatus: "complete" | "gaps_noted_after_retry";
  /** The completeness audit's own final assessment string, kept for operator/debug visibility of what "gaps_noted_after_retry" actually found — the same real text logged via onProgress during the run. */
  coverageNotes?: string;
}
