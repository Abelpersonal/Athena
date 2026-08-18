import type { SynthesizeSubtopicOutput } from "../orchestrator/templates/synthesizeSubtopic.js";
import type { RestructureLayersOutput } from "../orchestrator/templates/restructureLayers.js";
import type { DepthAuditScoreOutput } from "../orchestrator/templates/depthAuditScore.js";

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
}
