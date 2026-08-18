import { describe, it, expect } from "vitest";
import { runResearchPipeline, ResearchPipelineError } from "../src/research/pipeline.js";
import type { OrchestratorRunFn } from "../src/research/pipeline.js";
import type { OrchestratorResult, RunOptions } from "../src/orchestrator/index.js";
import type { SearchProvider, SearchResult } from "../src/mcp/webSearch.js";
import type { CleanedContent } from "../src/extraction/fetchAndClean.js";

function fakeSearchProvider(): SearchProvider {
  let counter = 0;
  return {
    async search(queries: string[]): Promise<SearchResult[]> {
      return queries.map((q) => {
        counter += 1;
        return {
          url: `https://example.com/s${counter}`,
          title: `Result ${counter}`,
          snippet: `Snippet for ${q}`,
          source_id: `src_${counter}`,
          query: q,
        };
      });
    },
  };
}

const fakeFetchAndClean = async (url: string): Promise<CleanedContent> => ({
  text: "x".repeat(500),
  title: `Title for ${url}`,
  extractionConfidence: 0.8,
  sourceType: "article",
});

/**
 * A configurable fake orchestrator.run() for pipeline-level tests. Handles
 * every task_type the pipeline calls; `auditResultsByTitle` lets a test
 * script exactly which depth_audit_score verdict comes back on which
 * attempt, per subtopic, to drive the retry logic deterministically.
 */
function makeOrchestratorMock(opts: {
  subtopics: Array<{ title: string; description: string }>;
  auditResultsByTitle?: Record<string, boolean[]>;
}): OrchestratorRunFn {
  const auditCallCounts = new Map<string, number>();

  async function mockRun<T = unknown>(
    taskType: string,
    context: Record<string, unknown>,
    _callingModule: string,
    _options?: RunOptions
  ): Promise<OrchestratorResult<T>> {
    const respond = <D>(data: D): OrchestratorResult<T> => ({
      taskType,
      promptVersion: "test",
      data: data as unknown as T,
      attempts: 1,
      raw: JSON.stringify(data),
    });

    switch (taskType) {
      case "decompose_topic":
        return respond({ prerequisites: ["prereq A"], subtopics: opts.subtopics });

      case "generate_search_queries":
      case "generate_contention_queries":
        return respond({ queries: ["q1", "q2"] });

      case "extract_grounded_key_points": {
        const sources = (context.sources as Array<{ source_id: string }>) ?? [];
        return respond({ keyPoints: sources.map((s, i) => ({ point: `point ${i}`, source_id: s.source_id })) });
      }

      case "synthesize_subtopic": {
        const validIds = (context.validSourceIds as string[]) ?? [];
        return respond({
          claims: [{ text: "claim", source_ids: [validIds[0]!], addressesContention: false }],
          contentionNotes: [],
        });
      }

      case "restructure_layers": {
        const validIds = (context.validSourceIds as string[]) ?? [];
        const layer = () => ({ text: "x".repeat(50), source_ids: [validIds[0]!] });
        return respond({
          layers: {
            intuition: layer(),
            mechanics: layer(),
            formal: layer(),
            application: layer(),
            frontier: layer(),
          },
        });
      }

      case "depth_audit_score": {
        const subtopicTitle = String(context.subtopicTitle);
        const count = (auditCallCounts.get(subtopicTitle) ?? 0) + 1;
        auditCallCounts.set(subtopicTitle, count);
        const sequence = opts.auditResultsByTitle?.[subtopicTitle] ?? [true];
        const pass = sequence[Math.min(count - 1, sequence.length - 1)] ?? true;
        const criterion = (ok: boolean) => ({ pass: ok, reason: ok ? "ok" : "not enough depth" });
        return respond({
          criteria: {
            prerequisitesCovered: criterion(true),
            misconceptionsAddressed: criterion(pass),
            beyondIntroDepth: criterion(true),
            allLayersPresent: criterion(true),
          },
        });
      }

      case "classify_volatility":
        return respond({ tier: "slow", justification: "test" });

      default:
        throw new Error(`No mock for task type "${taskType}"`);
    }
  }

  return mockRun;
}

describe("runResearchPipeline", () => {
  it("assigns unique ids to subtopics, including when titles collide (decomposition parsing)", async () => {
    const orchestratorRun = makeOrchestratorMock({
      subtopics: [
        { title: "Wave Functions", description: "d1" },
        { title: "Wave Functions", description: "d2" },
      ],
    });

    const course = await runResearchPipeline("Quantum Mechanics", {
      orchestratorRun,
      searchProvider: fakeSearchProvider(),
      fetchAndClean: fakeFetchAndClean,
    });

    expect(course.subtopics).toHaveLength(2);
    expect(course.subtopics[0]!.id).toBe("wave-functions");
    expect(course.subtopics[1]!.id).toBe("wave-functions-2");
    expect(course.prerequisites).toEqual(["prereq A"]);
  });

  it("retries a subtopic that fails its first depth audit and marks it passed after a successful retry", async () => {
    const orchestratorRun = makeOrchestratorMock({
      subtopics: [{ title: "Failing Then Passing", description: "d" }],
      auditResultsByTitle: { "Failing Then Passing": [false, true] },
    });

    const course = await runResearchPipeline("Some Topic", {
      orchestratorRun,
      searchProvider: fakeSearchProvider(),
      fetchAndClean: fakeFetchAndClean,
    });

    const subtopic = course.subtopics[0]!;
    expect(subtopic.auditPasses).toHaveLength(2);
    expect(subtopic.auditPasses[0]!.overallPass).toBe(false);
    expect(subtopic.auditPasses[1]!.overallPass).toBe(true);
    expect(subtopic.auditStatus).toBe("passed");
  });

  it("ships a subtopic flagged shallow_after_retry when it still fails after the retry budget", async () => {
    const orchestratorRun = makeOrchestratorMock({
      subtopics: [{ title: "Always Shallow", description: "d" }],
      auditResultsByTitle: { "Always Shallow": [false, false] },
    });

    const course = await runResearchPipeline("Some Topic", {
      orchestratorRun,
      searchProvider: fakeSearchProvider(),
      fetchAndClean: fakeFetchAndClean,
      maxAuditRetries: 1,
    });

    const subtopic = course.subtopics[0]!;
    // original pass + exactly one retry, then stop (bounded cost) rather than looping indefinitely.
    expect(subtopic.auditPasses).toHaveLength(2);
    expect(subtopic.auditStatus).toBe("shallow_after_retry");
  });

  it("passes a subtopic on the first attempt without retrying when the audit passes immediately", async () => {
    const orchestratorRun = makeOrchestratorMock({
      subtopics: [{ title: "Immediately Fine", description: "d" }],
    });

    const course = await runResearchPipeline("Some Topic", {
      orchestratorRun,
      searchProvider: fakeSearchProvider(),
      fetchAndClean: fakeFetchAndClean,
    });

    expect(course.subtopics[0]!.auditPasses).toHaveLength(1);
    expect(course.subtopics[0]!.auditStatus).toBe("passed");
  });

  it("throws ResearchPipelineError when no usable sources are found for a subtopic", async () => {
    const orchestratorRun = makeOrchestratorMock({
      subtopics: [{ title: "No Sources", description: "d" }],
    });
    const emptySearchProvider: SearchProvider = { search: async () => [] };

    await expect(
      runResearchPipeline("Some Topic", {
        orchestratorRun,
        searchProvider: emptySearchProvider,
        fetchAndClean: fakeFetchAndClean,
      })
    ).rejects.toThrow(ResearchPipelineError);
  });

  it("fails closed (ResearchPipelineError) rather than proceeding when every extraction is below the confidence floor", async () => {
    const orchestratorRun = makeOrchestratorMock({
      subtopics: [{ title: "All Low Confidence", description: "d" }],
    });
    const lowConfidenceFetch = async (): Promise<CleanedContent> => ({
      text: "too short to matter",
      title: "t",
      extractionConfidence: 0.1,
      sourceType: "low_confidence",
    });

    await expect(
      runResearchPipeline("Some Topic", {
        orchestratorRun,
        searchProvider: fakeSearchProvider(),
        fetchAndClean: lowConfidenceFetch,
        minExtractionConfidence: 0.3,
      })
    ).rejects.toThrow(ResearchPipelineError);
  });

  it("excludes only the low-confidence extractions from a subtopic's source set, keeping the usable ones", async () => {
    const orchestratorRun = makeOrchestratorMock({
      subtopics: [{ title: "Mixed Confidence Sources", description: "d" }],
    });
    // fakeSearchProvider() yields https://example.com/s1..s4 for this subtopic's one pass
    // (2 initial-search queries + 2 contention-search queries). Odd-numbered urls are low confidence.
    const mixedConfidenceFetch = async (url: string): Promise<CleanedContent> => {
      const isLow = /s(1|3)$/.test(url);
      return {
        text: "x".repeat(500),
        title: `Title for ${url}`,
        extractionConfidence: isLow ? 0.1 : 0.8,
        sourceType: isLow ? "low_confidence" : "article",
      };
    };

    const course = await runResearchPipeline("Some Topic", {
      orchestratorRun,
      searchProvider: fakeSearchProvider(),
      fetchAndClean: mixedConfidenceFetch,
      minExtractionConfidence: 0.3,
    });

    const subtopic = course.subtopics[0]!;
    expect(subtopic.sources.length).toBeGreaterThan(0);
    expect(subtopic.sources.every((s) => s.extractionConfidence >= 0.3)).toBe(true);
  });
});
