import type { SynthesizeSubtopicOutput } from "../orchestrator/templates/synthesizeSubtopic.js";
import type { RestructureLayersOutput } from "../orchestrator/templates/restructureLayers.js";
import type { DepthAuditScoreOutput } from "../orchestrator/templates/depthAuditScore.js";
import type { ExtractGroundedKeyPointsOutput } from "../orchestrator/templates/extractGroundedKeyPoints.js";

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
}
