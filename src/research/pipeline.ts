import { run as orchestratorRun } from "../orchestrator/index.js";
import { webSearch } from "../mcp/webSearch.js";
import type { SearchProvider, SearchResult } from "../mcp/webSearch.js";
import { fetchAndClean as fetchAndCleanDefault } from "../extraction/fetchAndClean.js";
import { createCitationValidator } from "./grounding.js";
import type { CourseJson, SourceRecord, SubtopicResult, AuditPassRecord } from "./types.js";
import type { DecomposeTopicOutput } from "../orchestrator/templates/decomposeTopic.js";
import type { SearchQueriesOutput } from "../orchestrator/templates/generateSearchQueries.js";
import type {
  ExtractGroundedKeyPointsOutput,
  SourceExcerpt,
} from "../orchestrator/templates/extractGroundedKeyPoints.js";
import type { SynthesizeSubtopicOutput } from "../orchestrator/templates/synthesizeSubtopic.js";
import type { RestructureLayersOutput } from "../orchestrator/templates/restructureLayers.js";
import type { DepthAuditScoreOutput } from "../orchestrator/templates/depthAuditScore.js";
import type { ClassifyVolatilityOutput } from "../orchestrator/templates/classifyVolatility.js";

export type OrchestratorRunFn = typeof orchestratorRun;
export type FetchAndCleanFn = typeof fetchAndCleanDefault;
export type ProgressListener = (message: string) => void;

const DEFAULT_MAX_AUDIT_RETRIES = 1;
const DEFAULT_MAX_SOURCES_PER_PASS = 5;
const DEFAULT_MIN_EXTRACTION_CONFIDENCE = 0.3;
/** decompose_topic returning this many (or more) subtopics is a signal the topic is probably Goal/Syllabus-shaped (Phase 5), not a single course. */
const SUBTOPIC_COUNT_WARNING_THRESHOLD = 15;
/** Per-source character cap fed into any prompt, so a handful of long articles doesn't blow the context/cost budget. */
const MAX_SOURCE_TEXT_CHARS = 4000;

export class ResearchPipelineError extends Error {}

export interface RunResearchPipelineOptions {
  diagnosticAnswers?: string[];
  /** Retries after the first depth-audit failure, per subtopic, before shipping it flagged as shallow. Default: 1 (original pass + one corrected pass). */
  maxAuditRetries?: number;
  maxSourcesPerPass?: number;
  minExtractionConfidence?: number;
  /** Injectable for tests and the harness's --dry-run mode. Default: the real Tavily MCP provider. */
  searchProvider?: SearchProvider;
  /** Injectable for tests and the harness's --dry-run mode. Default: the real orchestrator.run(). */
  orchestratorRun?: OrchestratorRunFn;
  /** Injectable for tests and the harness's --dry-run mode. Default: the real fetchAndClean(). */
  fetchAndClean?: FetchAndCleanFn;
  onProgress?: ProgressListener;
}

interface ResolvedDeps {
  orchestratorRun: OrchestratorRunFn;
  searchProvider: SearchProvider;
  fetchAndClean: FetchAndCleanFn;
  maxSourcesPerPass: number;
  minExtractionConfidence: number;
  onProgress?: ProgressListener;
}

/**
 * The Research Agent's full multi-pass pipeline (Phase 2 + the 2.5 depth
 * audit): topic -> decompose -> per-subtopic multi-pass research, synthesis,
 * layering, and audit-and-retry -> volatility tagging -> structured course
 * JSON. Every [LLM] step in the spec routes through orchestrator.run();
 * every [MCP] step routes through a SearchProvider; every [code] step is
 * plain TypeScript below. Nothing here persists to a database or builds
 * course/module/lesson sequencing — that's Phase 3's Course Builder,
 * consuming this function's return value directly.
 */
export async function runResearchPipeline(
  topic: string,
  options: RunResearchPipelineOptions = {}
): Promise<CourseJson> {
  const deps: ResolvedDeps = {
    orchestratorRun: options.orchestratorRun ?? orchestratorRun,
    searchProvider: options.searchProvider ?? { search: webSearch },
    fetchAndClean: options.fetchAndClean ?? fetchAndCleanDefault,
    maxSourcesPerPass: options.maxSourcesPerPass ?? DEFAULT_MAX_SOURCES_PER_PASS,
    minExtractionConfidence: options.minExtractionConfidence ?? DEFAULT_MIN_EXTRACTION_CONFIDENCE,
    onProgress: options.onProgress,
  };
  const maxAuditRetries = options.maxAuditRetries ?? DEFAULT_MAX_AUDIT_RETRIES;

  // Step 1: decompose
  deps.onProgress?.(`Decomposing topic: "${topic}"...`);
  const decompose = await deps.orchestratorRun<DecomposeTopicOutput>(
    "decompose_topic",
    { topic, diagnosticAnswers: options.diagnosticAnswers ?? [] },
    "research-agent"
  );
  const { prerequisites, subtopics: rawSubtopics } = decompose.data;

  if (rawSubtopics.length >= SUBTOPIC_COUNT_WARNING_THRESHOLD) {
    console.warn(
      `[research] decompose_topic returned ${rawSubtopics.length} subtopics for "${topic}" — this may be ` +
        "too broad for a single course and might fit Goal/Syllabus mode (Phase 5) better. Proceeding anyway."
    );
  }

  const ids = assignUniqueIds(rawSubtopics.map((s) => s.title));
  const subtopics: SubtopicResult[] = [];
  for (let i = 0; i < rawSubtopics.length; i++) {
    const raw = rawSubtopics[i]!;
    const id = ids[i]!;
    deps.onProgress?.(`--- Subtopic ${i + 1}/${rawSubtopics.length}: ${raw.title} ---`);
    subtopics.push(
      await processSubtopic({
        id,
        title: raw.title,
        description: raw.description,
        topic,
        prerequisites,
        maxAuditRetries,
        deps,
      })
    );
  }

  return { topic, prerequisites, subtopics, generatedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Per-subtopic: research pass(es) (2a-2h) -> depth audit (3) -> retry (4) -> volatility (5)
// ---------------------------------------------------------------------------

interface ProcessSubtopicInput {
  id: string;
  title: string;
  description: string;
  topic: string;
  prerequisites: string[];
  maxAuditRetries: number;
  deps: ResolvedDeps;
}

async function processSubtopic(input: ProcessSubtopicInput): Promise<SubtopicResult> {
  const { orchestratorRun: run, onProgress } = input.deps;
  let gapInstruction: string | undefined;
  let attempt = 0;
  let passResult: ResearchPassResult | undefined;
  const auditPasses: AuditPassRecord[] = [];
  let overallPass = false;

  for (;;) {
    attempt += 1;
    onProgress?.(
      `Subtopic "${input.title}" — research pass ${attempt}${gapInstruction ? " (targeted retry)" : ""}...`
    );
    passResult = await researchPass({
      topic: input.topic,
      subtopicTitle: input.title,
      subtopicDescription: input.description,
      gapInstruction,
      deps: input.deps,
    });

    const audit = await runDepthAudit(run, {
      subtopicTitle: input.title,
      prerequisites: input.prerequisites,
      layers: passResult.layers,
      contentionNotes: passResult.synthesis.contentionNotes,
    });
    auditPasses.push({ attempt, criteria: audit.criteria, overallPass: audit.overallPass });

    if (audit.overallPass) {
      overallPass = true;
      onProgress?.(`Subtopic "${input.title}" passed the depth audit on attempt ${attempt}.`);
      break;
    }

    const gap = summarizeFailingCriteria(audit.criteria);
    onProgress?.(`Subtopic "${input.title}" FAILED the depth audit on attempt ${attempt}: ${gap}`);

    if (attempt > input.maxAuditRetries) {
      overallPass = false;
      onProgress?.(`Subtopic "${input.title}" exhausted audit retries — shipping flagged as shallow_after_retry.`);
      break;
    }

    gapInstruction = gap;
  }

  const volatility = await classifyVolatilityForSources(run, input.topic, passResult.sources);

  return {
    id: input.id,
    title: input.title,
    description: input.description,
    sources: passResult.sources,
    synthesis: passResult.synthesis,
    layers: passResult.layers,
    auditPasses,
    auditStatus: overallPass ? "passed" : "shallow_after_retry",
    volatility,
  };
}

interface ResearchPassInput {
  topic: string;
  subtopicTitle: string;
  subtopicDescription: string;
  gapInstruction?: string;
  deps: ResolvedDeps;
}

interface ResearchPassResult {
  sources: SourceRecord[];
  synthesis: SynthesizeSubtopicOutput;
  layers: RestructureLayersOutput["layers"];
}

/** Steps 2a-2h for a single research pass over one subtopic. */
async function researchPass(input: ResearchPassInput): Promise<ResearchPassResult> {
  const { orchestratorRun: run, searchProvider, fetchAndClean, maxSourcesPerPass, minExtractionConfidence, onProgress } =
    input.deps;
  const gapInstruction = input.gapInstruction;

  // 2a: initial search queries
  const queries = await run<SearchQueriesOutput>(
    "generate_search_queries",
    {
      topic: input.topic,
      subtopicTitle: input.subtopicTitle,
      subtopicDescription: input.subtopicDescription,
      gapInstruction,
    },
    "research-agent"
  );

  // 2b: web_search
  const initialSearchResults = await searchProvider.search(queries.data.queries);

  // 2c: fetch_and_clean (code, no LLM)
  const initialSources = await fetchAndCleanResults(
    initialSearchResults,
    "initial",
    maxSourcesPerPass,
    minExtractionConfidence,
    fetchAndClean,
    onProgress
  );

  // 2d: extract grounded key points — nothing to extract from if the initial pass found no usable sources.
  let extracted: ExtractGroundedKeyPointsOutput;
  if (initialSources.length === 0) {
    onProgress?.(`  no usable initial sources for "${input.subtopicTitle}" — skipping extract_grounded_key_points.`);
    extracted = { keyPoints: [] };
  } else {
    const initialValidIds = new Set(initialSources.map((s) => s.source_id));
    const result = await run<ExtractGroundedKeyPointsOutput>(
      "extract_grounded_key_points",
      { subtopicTitle: input.subtopicTitle, sources: initialSources.map(toSourceExcerpt), gapInstruction },
      "research-agent",
      {
        validateExtra: createCitationValidator(initialValidIds, (data) =>
          (data as ExtractGroundedKeyPointsOutput).keyPoints.map((kp) => kp.source_id)
        ),
      }
    );
    extracted = result.data;
  }

  // 2e: contention-focused queries
  const contentionQueries = await run<SearchQueriesOutput>(
    "generate_contention_queries",
    {
      topic: input.topic,
      subtopicTitle: input.subtopicTitle,
      subtopicDescription: input.subtopicDescription,
      gapInstruction,
    },
    "research-agent"
  );
  const contentionSearchResults = await searchProvider.search(contentionQueries.data.queries);

  // 2f: fetch_and_clean contention results
  const contentionSources = await fetchAndCleanResults(
    contentionSearchResults,
    "contention",
    maxSourcesPerPass,
    minExtractionConfidence,
    fetchAndClean,
    onProgress
  );

  const allSources = dedupeSources([...initialSources, ...contentionSources]);
  const allValidIds = new Set(allSources.map((s) => s.source_id));

  if (allValidIds.size === 0) {
    throw new ResearchPipelineError(
      `No usable sources were found for subtopic "${input.subtopicTitle}" (topic: "${input.topic}") after both ` +
        "search passes. Check TAVILY_API_KEY / network access, or whether this topic has web coverage at all."
    );
  }

  // 2g: synthesize ALL notes into one unified, cited explanation
  const synthesis = await run<SynthesizeSubtopicOutput>(
    "synthesize_subtopic",
    {
      subtopicTitle: input.subtopicTitle,
      groundedKeyPoints: extracted.keyPoints,
      contentionMaterial: contentionSources.map(toSourceExcerpt),
      validSourceIds: [...allValidIds],
      gapInstruction,
    },
    "research-agent",
    { validateExtra: createCitationValidator(allValidIds, extractSynthesisCitations) }
  );

  // 2h: restructure into depth layers
  const layers = await run<RestructureLayersOutput>(
    "restructure_layers",
    {
      subtopicTitle: input.subtopicTitle,
      synthesis: synthesis.data,
      validSourceIds: [...allValidIds],
      gapInstruction,
    },
    "research-agent",
    { validateExtra: createCitationValidator(allValidIds, extractLayersCitations) }
  );

  return { sources: allSources, synthesis: synthesis.data, layers: layers.data.layers };
}

// ---------------------------------------------------------------------------
// Step 3: depth audit
// ---------------------------------------------------------------------------

async function runDepthAudit(
  run: OrchestratorRunFn,
  input: {
    subtopicTitle: string;
    prerequisites: string[];
    layers: RestructureLayersOutput["layers"];
    contentionNotes: SynthesizeSubtopicOutput["contentionNotes"];
  }
): Promise<{ criteria: DepthAuditScoreOutput["criteria"]; overallPass: boolean }> {
  const result = await run<DepthAuditScoreOutput>(
    "depth_audit_score",
    {
      subtopicTitle: input.subtopicTitle,
      prerequisites: input.prerequisites,
      layers: input.layers,
      contentionNotes: input.contentionNotes,
    },
    "research-agent"
  );
  // Computed here rather than trusted from the model: overallPass is a strict
  // AND of every criterion, not a separate field the model could get out of
  // sync with its own per-criterion verdicts.
  const overallPass = Object.values(result.data.criteria).every((c) => c.pass);
  return { criteria: result.data.criteria, overallPass };
}

function summarizeFailingCriteria(criteria: DepthAuditScoreOutput["criteria"]): string {
  return Object.entries(criteria)
    .filter(([, c]) => !c.pass)
    .map(([name, c]) => `${name} — ${c.reason}`)
    .join("; ");
}

// ---------------------------------------------------------------------------
// Step 5: volatility tagging
// ---------------------------------------------------------------------------

async function classifyVolatilityForSources(
  run: OrchestratorRunFn,
  topic: string,
  sources: SourceRecord[]
): Promise<ClassifyVolatilityOutput> {
  const result = await run<ClassifyVolatilityOutput>(
    "classify_volatility",
    {
      topic,
      sourcesUsed: sources.map((s) => ({
        url: s.url,
        domain: s.domain,
        ...(s.publishedDate ? { publishedDate: s.publishedDate } : {}),
      })),
    },
    "research-agent"
  );
  return result.data;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "subtopic";
}

function assignUniqueIds(titles: string[]): string[] {
  const seen = new Map<string, number>();
  return titles.map((title) => {
    const base = slugify(title);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  });
}

function dedupeByUrl(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of results) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    out.push(r);
  }
  return out;
}

function dedupeSources(sources: SourceRecord[]): SourceRecord[] {
  const seen = new Map<string, SourceRecord>();
  for (const s of sources) {
    if (!seen.has(s.source_id)) seen.set(s.source_id, s);
  }
  return [...seen.values()];
}

async function fetchAndCleanResults(
  results: SearchResult[],
  role: "initial" | "contention",
  maxSources: number,
  minConfidence: number,
  fetchAndCleanFn: FetchAndCleanFn,
  onProgress?: ProgressListener
): Promise<SourceRecord[]> {
  const deduped = dedupeByUrl(results).slice(0, maxSources);
  const cleaned = await Promise.all(
    deduped.map(async (r): Promise<SourceRecord | null> => {
      const content = await fetchAndCleanFn(r.url);
      if (content.extractionConfidence < minConfidence) {
        onProgress?.(
          `  excluding low-confidence source (${content.extractionConfidence.toFixed(2)} < ${minConfidence}): ${r.url}`
        );
        return null;
      }
      return {
        source_id: r.source_id,
        url: r.url,
        title: content.title || r.title,
        text: content.text,
        extractionConfidence: content.extractionConfidence,
        domain: safeHostname(r.url),
        query: r.query,
        role,
        ...(r.publishedDate ? { publishedDate: r.publishedDate } : {}),
      };
    })
  );
  return cleaned.filter((r): r is SourceRecord => r !== null);
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function truncateForPrompt(text: string): string {
  if (text.length <= MAX_SOURCE_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_SOURCE_TEXT_CHARS)}\n...[truncated]`;
}

function toSourceExcerpt(source: SourceRecord): SourceExcerpt {
  return {
    source_id: source.source_id,
    url: source.url,
    title: source.title,
    text: truncateForPrompt(source.text),
  };
}

function extractSynthesisCitations(data: unknown): string[] {
  const d = data as SynthesizeSubtopicOutput;
  return [...d.claims.flatMap((c) => c.source_ids), ...d.contentionNotes.flatMap((n) => n.source_ids)];
}

function extractLayersCitations(data: unknown): string[] {
  const d = data as RestructureLayersOutput;
  return Object.values(d.layers).flatMap((l) => l.source_ids);
}
