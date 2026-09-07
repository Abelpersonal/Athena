import { run as orchestratorRun } from "../orchestrator/index.js";
import { webSearch } from "../mcp/webSearch.js";
import type { SearchProvider, SearchResult } from "../mcp/webSearch.js";
import { fetchAndClean as fetchAndCleanDefault } from "../extraction/fetchAndClean.js";
import { createCitationValidator, checkLocatorSanity } from "./grounding.js";
import { assignUniqueIds } from "../shared/ids.js";
import type { CourseJson, SourceRecord, SubtopicResult, AuditPassRecord } from "./types.js";
import type { DecomposeTopicOutput } from "../orchestrator/templates/decomposeTopic.js";
import type { AuditDecompositionCompletenessOutput } from "../orchestrator/templates/auditDecompositionCompleteness.js";
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
/**
 * Coverage Completeness Audit addition: how many times audit_decomposition_completeness re-runs
 * after an initial "incomplete" verdict, matching the per-subtopic depth audit's own default
 * (DEFAULT_MAX_AUDIT_RETRIES above) — one retry, then ship regardless of the outcome. Not exposed
 * as a RunResearchPipelineOptions field (unlike maxAuditRetries) since the kickoff's own resolved
 * default is a fixed "one retry, matching the depth audit," not something callers need to tune.
 */
const MAX_COMPLETENESS_AUDIT_RETRIES = 1;
const DEFAULT_MAX_SOURCES_PER_PASS = 5;
const DEFAULT_MIN_EXTRACTION_CONFIDENCE = 0.3;
/** decompose_topic returning this many (or more) subtopics is a signal the topic is probably Goal/Syllabus-shaped (Phase 5), not a single course. */
const SUBTOPIC_COUNT_WARNING_THRESHOLD = 15;
/**
 * A hard ceiling — 3x the warning threshold — beyond which the pipeline refuses to proceed rather
 * than silently running an implausible number of subtopics (each its own multi-call research
 * pass, plus possible depth-audit retries). A second, structural line of defense alongside the
 * Orchestrator's own dollar cost cap (ORCHESTRATOR_SESSION_BUDGET_USD) — this one is free and
 * fires before the run has spent anything on a runaway decomposition, whether or not a budget is
 * even configured.
 */
const SUBTOPIC_COUNT_HARD_LIMIT = SUBTOPIC_COUNT_WARNING_THRESHOLD * 3;
/** Per-source character cap fed into any prompt, so a handful of long articles doesn't blow the context/cost budget. */
const MAX_SOURCE_TEXT_CHARS = 4000;

export class ResearchPipelineError extends Error {}

export interface RunResearchPipelineOptions {
  diagnosticAnswers?: string[];
  /** Retries after the first depth-audit failure, per subtopic, before shipping it flagged as shallow. Default: 1 (original pass + one corrected pass). */
  maxAuditRetries?: number;
  maxSourcesPerPass?: number;
  minExtractionConfidence?: number;
  /**
   * Phase 5 additive option: optional goal/domain framing (e.g. "for becoming a full-stack
   * quant, Math domain: prerequisite for portfolio optimization") threaded into decompose_topic
   * and synthesize_subtopic's prompts as extra framing — it biases emphasis, never depth;
   * fundamentals are still covered rigorously either way. Absent (the default) for every
   * standalone call from Phases 1-4, so their behavior is completely unchanged. See README,
   * "Goal-scoped depth (Phase 5's additive researchAgent option)".
   */
  goalContext?: string;
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
/** Shared dep-resolution for both a full pipeline run and a standalone backfillSubtopic() call. */
function resolveDeps(options: {
  maxSourcesPerPass?: number;
  minExtractionConfidence?: number;
  searchProvider?: SearchProvider;
  orchestratorRun?: OrchestratorRunFn;
  fetchAndClean?: FetchAndCleanFn;
  onProgress?: ProgressListener;
}): ResolvedDeps {
  return {
    orchestratorRun: options.orchestratorRun ?? orchestratorRun,
    searchProvider: options.searchProvider ?? { search: webSearch },
    fetchAndClean: options.fetchAndClean ?? fetchAndCleanDefault,
    maxSourcesPerPass: options.maxSourcesPerPass ?? DEFAULT_MAX_SOURCES_PER_PASS,
    minExtractionConfidence: options.minExtractionConfidence ?? DEFAULT_MIN_EXTRACTION_CONFIDENCE,
    onProgress: options.onProgress,
  };
}

export async function runResearchPipeline(
  topic: string,
  options: RunResearchPipelineOptions = {}
): Promise<CourseJson> {
  const deps = resolveDeps(options);
  const maxAuditRetries = options.maxAuditRetries ?? DEFAULT_MAX_AUDIT_RETRIES;

  // Step 1: decompose
  deps.onProgress?.(`Decomposing topic: "${topic}"...`);
  const decompose = await deps.orchestratorRun<DecomposeTopicOutput>(
    "decompose_topic",
    { topic, diagnosticAnswers: options.diagnosticAnswers ?? [], goalContext: options.goalContext },
    "research-agent"
  );
  const { prerequisites, subtopics: rawSubtopics } = decompose.data;
  checkSubtopicCountCeilings(rawSubtopics.length, topic);

  // Coverage Completeness Audit addition: BEFORE any per-subtopic research begins, ask whether
  // the proposed subtopic LIST itself is complete — the existing depth audit (step 3, below) only
  // ever checks depth WITHIN an already-chosen subtopic and has no way to notice one that was
  // never proposed at all. This audit can only ever GROW the list (append missing subtopics,
  // never remove any) — so the count ceilings just checked above are re-checked below if the
  // audit's retry actually appended anything, since a grown list could newly cross a threshold
  // the original decomposition didn't.
  deps.onProgress?.(`Checking subtopic decomposition completeness for "${topic}"...`);
  const completeness = await auditDecompositionCompleteness({
    run: deps.orchestratorRun,
    topic,
    prerequisites,
    subtopics: rawSubtopics,
    goalContext: options.goalContext,
    onProgress: deps.onProgress,
  });
  if (completeness.subtopics.length !== rawSubtopics.length) {
    checkSubtopicCountCeilings(completeness.subtopics.length, topic);
  }
  const auditedSubtopics = completeness.subtopics;

  const ids = assignUniqueIds(auditedSubtopics.map((s) => s.title), { fallback: "subtopic" });
  const subtopics: SubtopicResult[] = [];
  for (let i = 0; i < auditedSubtopics.length; i++) {
    const raw = auditedSubtopics[i]!;
    const id = ids[i]!;
    deps.onProgress?.(`--- Subtopic ${i + 1}/${auditedSubtopics.length}: ${raw.title} ---`);
    subtopics.push(
      await processSubtopic({
        id,
        title: raw.title,
        description: raw.description,
        topic,
        prerequisites,
        maxAuditRetries,
        goalContext: options.goalContext,
        deps,
      })
    );
  }

  return {
    topic,
    prerequisites,
    subtopics,
    generatedAt: new Date().toISOString(),
    coverageStatus: completeness.coverageStatus,
    ...(completeness.assessment ? { coverageNotes: completeness.assessment } : {}),
    ...(options.goalContext ? { goalContext: options.goalContext } : {}),
  };
}

// ---------------------------------------------------------------------------
// Coverage Completeness Audit addition: subtopic-count ceilings + the new
// decomposition-completeness audit that sits above the existing per-subtopic depth audit.
// ---------------------------------------------------------------------------

function checkSubtopicCountCeilings(subtopicCount: number, topic: string): void {
  if (subtopicCount >= SUBTOPIC_COUNT_HARD_LIMIT) {
    throw new ResearchPipelineError(
      `decompose_topic returned ${subtopicCount} subtopics for "${topic}" — this exceeds the hard ` +
        `ceiling of ${SUBTOPIC_COUNT_HARD_LIMIT} (3x the ${SUBTOPIC_COUNT_WARNING_THRESHOLD}-subtopic warning ` +
        "threshold). Refusing to proceed rather than running an implausibly large number of subtopics — this " +
        "topic almost certainly needs Goal/Syllabus mode (Phase 5) instead of a single course."
    );
  }
  if (subtopicCount >= SUBTOPIC_COUNT_WARNING_THRESHOLD) {
    console.warn(
      `[research] decompose_topic returned ${subtopicCount} subtopics for "${topic}" — this may be ` +
        "too broad for a single course and might fit Goal/Syllabus mode (Phase 5) better. Proceeding anyway."
    );
  }
}

interface DecompositionCompletenessResult {
  subtopics: DecomposeTopicOutput["subtopics"];
  coverageStatus: "complete" | "gaps_noted_after_retry";
  assessment?: string;
}

/**
 * A NEW, separate audit above the existing per-subtopic depth audit (runDepthAudit, below) — that
 * one only ever asks "is THIS subtopic's content deep enough?" once real content exists for it.
 * This one runs first, before any research happens, against the proposed subtopic LIST itself
 * (there's no fetched content yet at this point in the pipeline). Mirrors the depth audit's own
 * single-retry shape exactly: one initial attempt, and on failure exactly one retry against the
 * list grown with whatever the first attempt reported missing — then ship regardless of the
 * retry's own outcome (never loops further), flagging `coverageStatus` rather than blocking course
 * generation. Never modifies the depth audit's own scope/criteria.
 */
async function auditDecompositionCompleteness(input: {
  run: OrchestratorRunFn;
  topic: string;
  prerequisites: string[];
  subtopics: DecomposeTopicOutput["subtopics"];
  goalContext?: string;
  onProgress?: ProgressListener;
}): Promise<DecompositionCompletenessResult> {
  let subtopics = input.subtopics;
  let attempt = 0;

  for (;;) {
    attempt += 1;
    const result = await input.run<AuditDecompositionCompletenessOutput>(
      "audit_decomposition_completeness",
      { topic: input.topic, prerequisites: input.prerequisites, subtopics, goalContext: input.goalContext },
      "research-agent"
    );

    if (result.data.complete) {
      input.onProgress?.(
        `Decomposition completeness audit passed on attempt ${attempt}: ${result.data.assessment}`
      );
      return { subtopics, coverageStatus: "complete", assessment: result.data.assessment };
    }

    const missingTitles = result.data.missingSubtopics.map((s) => s.title).join(", ") || "(none named)";
    input.onProgress?.(
      `Decomposition completeness audit FAILED on attempt ${attempt}: ${result.data.assessment} ` +
        `(missing: ${missingTitles})`
    );

    if (attempt > MAX_COMPLETENESS_AUDIT_RETRIES) {
      input.onProgress?.(
        `Decomposition completeness audit exhausted its retry — shipping flagged as gaps_noted_after_retry.`
      );
      return { subtopics, coverageStatus: "gaps_noted_after_retry", assessment: result.data.assessment };
    }

    subtopics = [...subtopics, ...result.data.missingSubtopics];
  }
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
  goalContext?: string;
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
      goalContext: input.goalContext,
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
    keyPoints: passResult.keyPoints,
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
  /** Threaded only into synthesize_subtopic (see researchPass below) — not into the search-query/extraction calls in gatherSources(), per the PRD's additive-option scope. */
  goalContext?: string;
  deps: ResolvedDeps;
}

interface ResearchPassResult {
  sources: SourceRecord[];
  keyPoints: ExtractGroundedKeyPointsOutput["keyPoints"];
  synthesis: SynthesizeSubtopicOutput;
  layers: RestructureLayersOutput["layers"];
}

interface GatherSourcesResult {
  sources: SourceRecord[];
  contentionSources: SourceRecord[];
  keyPoints: ExtractGroundedKeyPointsOutput["keyPoints"];
}

/**
 * Steps 2a-2f: two search+extract passes (an initial pass and a
 * contention-focused pass) over one subtopic, producing the deduped source
 * pool. Shared by researchPass() (which continues on to 2g/2h — synthesis
 * and layering) and the standalone backfillSubtopic() export, which only
 * needs more sources, not a re-synthesis — see the Material Aggregator
 * (Phase 3), the one place outside this module that reaches back in here.
 */
async function gatherSources(input: ResearchPassInput): Promise<GatherSourcesResult> {
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
      { subtopicTitle: input.subtopicTitle, sources: initialSources.flatMap(toSourceExcerpts), gapInstruction },
      "research-agent",
      {
        validateExtra: createCitationValidator(initialValidIds, (data) =>
          (data as ExtractGroundedKeyPointsOutput).keyPoints.map((kp) => kp.source_id)
        ),
      }
    );
    extracted = result.data;

    // Soft check only (never blocks/retries) — see grounding.ts's checkLocatorSanity doc comment.
    const maxLocatorValueBySourceId = new Map(
      initialSources.filter((s) => s.maxLocatorValue !== undefined).map((s) => [s.source_id, s.maxLocatorValue!])
    );
    checkLocatorSanity(extracted.keyPoints, maxLocatorValueBySourceId);
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
  return { sources: allSources, contentionSources, keyPoints: extracted.keyPoints };
}

/** Steps 2a-2h for a single research pass over one subtopic. */
async function researchPass(input: ResearchPassInput): Promise<ResearchPassResult> {
  const { orchestratorRun: run } = input.deps;
  const gapInstruction = input.gapInstruction;

  const { sources: allSources, contentionSources, keyPoints } = await gatherSources(input);
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
      groundedKeyPoints: keyPoints,
      contentionMaterial: contentionSources.flatMap(toSourceExcerpts),
      validSourceIds: [...allValidIds],
      gapInstruction,
      goalContext: input.goalContext,
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

  return { sources: allSources, keyPoints, synthesis: synthesis.data, layers: layers.data.layers };
}

// ---------------------------------------------------------------------------
// Backfill (Phase 3): the one place outside this module that reaches back
// into the Research Agent — a narrow re-run of steps 2a-2f for a single
// subtopic that already shipped, when Phase 3's Material Aggregator finds
// it landed below the minimum valid-source threshold. No re-synthesis, no
// re-audit: just more candidate sources for the Material Aggregator to
// evaluate and (if usable) persist and link to the existing lesson.
// ---------------------------------------------------------------------------

export interface BackfillSubtopicInput {
  topic: string;
  subtopicTitle: string;
  subtopicDescription: string;
  /** Why the backfill was triggered (e.g. "only 1 valid source, need at least 2") — steers the search queries. */
  gapInstruction?: string;
}

export interface BackfillSubtopicOptions {
  maxSourcesPerPass?: number;
  minExtractionConfidence?: number;
  searchProvider?: SearchProvider;
  orchestratorRun?: OrchestratorRunFn;
  fetchAndClean?: FetchAndCleanFn;
  onProgress?: ProgressListener;
}

export async function backfillSubtopic(
  input: BackfillSubtopicInput,
  options: BackfillSubtopicOptions = {}
): Promise<SourceRecord[]> {
  const deps = resolveDeps(options);
  const { sources } = await gatherSources({
    topic: input.topic,
    subtopicTitle: input.subtopicTitle,
    subtopicDescription: input.subtopicDescription,
    gapInstruction: input.gapInstruction,
    deps,
  });
  return sources;
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
        ...(content.chunks ? { chunks: content.chunks } : {}),
        ...(content.maxLocatorValue !== undefined ? { maxLocatorValue: content.maxLocatorValue } : {}),
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

/**
 * A chunked (PDF/video) source fans out into one `SourceExcerpt` per chunk — each tagged with the
 * same `source_id` (grounding validates against that, unchanged) but its own `locator`, so the
 * model can cite a specific page/timestamp rather than the source as an undifferentiated whole.
 * A source with no `chunks` (every article, and any pdf/video that degraded to flat text) falls
 * back to exactly one excerpt with no locator — byte-identical to the old `toSourceExcerpt()`.
 */
function toSourceExcerpts(source: SourceRecord): SourceExcerpt[] {
  if (!source.chunks || source.chunks.length === 0) {
    return [
      {
        source_id: source.source_id,
        url: source.url,
        title: source.title,
        text: truncateForPrompt(source.text),
      },
    ];
  }
  return source.chunks.map((chunk) => ({
    source_id: source.source_id,
    url: source.url,
    title: source.title,
    text: truncateForPrompt(chunk.text),
    ...(chunk.locator ? { locator: chunk.locator } : {}),
  }));
}

function extractSynthesisCitations(data: unknown): string[] {
  const d = data as SynthesizeSubtopicOutput;
  return [...d.claims.flatMap((c) => c.source_ids), ...d.contentionNotes.flatMap((n) => n.source_ids)];
}

function extractLayersCitations(data: unknown): string[] {
  const d = data as RestructureLayersOutput;
  return Object.values(d.layers).flatMap((l) => l.source_ids);
}
