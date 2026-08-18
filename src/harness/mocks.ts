import type { OrchestratorResult, RunOptions } from "../orchestrator/index.js";
import type { OrchestratorRunFn, BackfillSubtopicInput, FetchAndCleanFn } from "../research/pipeline.js";
import type { SearchProvider, SearchResult } from "../mcp/webSearch.js";
import type { CleanedContent } from "../extraction/fetchAndClean.js";
import type { SourceRecord } from "../research/types.js";
import type { BackfillSubtopicFn } from "../materialAggregator/index.js";
import { slugify } from "../shared/ids.js";

/**
 * Canned dependencies for `npm run harness -- research --dry-run "<topic>"`.
 * These let you exercise the full research pipeline's control flow — every
 * step, the audit-retry loop included — without spending real API credits.
 * Not for validating output quality; only for validating wiring.
 */

let mockSourceCounter = 0;

export function createMockSearchProvider(): SearchProvider {
  return {
    async search(queries: string[]): Promise<SearchResult[]> {
      return queries.map((query) => {
        mockSourceCounter += 1;
        return {
          url: `https://example.com/mock-source-${mockSourceCounter}`,
          title: `Mock result for "${query}"`,
          snippet: `Canned snippet for query "${query}".`,
          source_id: `src_mock_${mockSourceCounter}`,
          query,
          publishedDate: "2025-01-01",
        };
      });
    },
  };
}

export async function mockFetchAndClean(url: string): Promise<CleanedContent> {
  return {
    text: `Canned mock article text standing in for the real page at ${url}. `.repeat(30),
    title: `Mock title for ${url}`,
    extractionConfidence: 0.9,
    sourceType: "article",
  };
}

/**
 * Forces the pipeline's FIRST subtopic to fail its depth audit on the first
 * pass and pass on the retry, so a dry run visibly demonstrates the audit
 * retry path (step 3/4) rather than only ever taking the happy path.
 */
export function createMockOrchestratorRun(): OrchestratorRunFn {
  const auditCallCounts = new Map<string, number>();

  async function mockRun<T = unknown>(
    taskType: string,
    context: Record<string, unknown>,
    _callingModule: string,
    _options?: RunOptions
  ): Promise<OrchestratorResult<T>> {
    const respond = <D>(data: D): OrchestratorResult<T> => ({
      taskType,
      promptVersion: "mock",
      data: data as unknown as T,
      attempts: 1,
      raw: JSON.stringify(data),
    });

    switch (taskType) {
      case "decompose_topic":
        return respond({
          prerequisites: ["Basic familiarity with the general subject area"],
          subtopics: [
            { title: "Mock Subtopic One", description: "First canned subtopic — used to demo the audit retry path." },
            { title: "Mock Subtopic Two", description: "Second canned subtopic — passes its audit immediately." },
            { title: "Mock Subtopic Three", description: "Third canned subtopic — depends on Subtopic One (Phase 3 sequencing demo)." },
          ],
        });

      case "generate_search_queries":
      case "generate_contention_queries":
        return respond({ queries: ["mock query one", "mock query two"] });

      case "extract_grounded_key_points": {
        const sources = (context.sources as Array<{ source_id: string }>) ?? [];
        return respond({
          keyPoints: sources.map((s, i) => ({ point: `Mock key point ${i + 1}`, source_id: s.source_id })),
        });
      }

      case "synthesize_subtopic": {
        const validIds = (context.validSourceIds as string[]) ?? [];
        const firstId = validIds[0] ?? "src_mock_unknown";
        return respond({
          claims: [{ text: "Mock synthesized claim citing the first available source.", source_ids: [firstId], addressesContention: false }],
          contentionNotes: [
            { description: "Mock contention point.", resolution: "Mock resolution.", source_ids: [firstId] },
          ],
        });
      }

      case "restructure_layers": {
        const validIds = (context.validSourceIds as string[]) ?? [];
        const firstId = validIds[0] ?? "src_mock_unknown";
        const layer = (label: string) => ({
          text: `Mock ${label} layer content, long enough to pass the minimum-length schema check used for dry-run wiring checks.`,
          source_ids: [firstId],
        });
        return respond({
          layers: {
            intuition: layer("intuition"),
            mechanics: layer("mechanics"),
            formal: layer("formal"),
            application: layer("application"),
            frontier: layer("frontier"),
          },
        });
      }

      case "depth_audit_score": {
        const subtopicTitle = String(context.subtopicTitle ?? "unknown");
        const count = (auditCallCounts.get(subtopicTitle) ?? 0) + 1;
        auditCallCounts.set(subtopicTitle, count);

        const forceFailFirst = subtopicTitle === "Mock Subtopic One" && count === 1;
        const criterion = (pass: boolean, reason: string) => ({ pass, reason });

        return respond({
          criteria: {
            prerequisitesCovered: criterion(true, "Mock: prerequisites treated as covered."),
            misconceptionsAddressed: criterion(
              !forceFailFirst,
              forceFailFirst
                ? "Mock: no misconception was explicitly addressed on this pass."
                : "Mock: a misconception was explicitly addressed."
            ),
            beyondIntroDepth: criterion(true, "Mock: content treated as beyond intro depth."),
            allLayersPresent: criterion(true, "Mock: all five layers are present."),
          },
        });
      }

      case "classify_volatility":
        return respond({ tier: "medium", justification: "Mock: assumed medium volatility for dry-run wiring checks." });

      case "sequence_modules": {
        const subtopics = (context.subtopics as Array<{ id: string; title: string }>) ?? [];
        const byTitle = (title: string) => subtopics.find((s) => s.title === title);
        const one = byTitle("Mock Subtopic One");
        const two = byTitle("Mock Subtopic Two");
        const three = byTitle("Mock Subtopic Three");

        // Deliberately constructed (Phase 3 demo): modules are returned in array order
        // [m3, m1, m2], but m1 is declared a prerequisite of m3. The final persisted order
        // must place m1 before m3 despite m3 being listed first here — demonstrating that
        // courseBuilder's code-side topological sort, not the model's own array order,
        // decides the real sequencing.
        if (one && two && three) {
          return respond({
            modules: [
              { tempId: "m3", subtopicIds: [three.id], prerequisiteOfTempIds: [] },
              { tempId: "m1", subtopicIds: [one.id], prerequisiteOfTempIds: ["m3"] },
              { tempId: "m2", subtopicIds: [two.id], prerequisiteOfTempIds: [] },
            ],
          });
        }

        return respond({
          modules: subtopics.map((s, i) => ({ tempId: `m${i + 1}`, subtopicIds: [s.id], prerequisiteOfTempIds: [] })),
        });
      }

      case "write_lesson_metadata": {
        const modulesCtx =
          (context.modules as Array<{ tempId: string; subtopics: Array<{ id: string; title: string }> }>) ?? [];
        return respond({
          modules: modulesCtx.map((m) => ({
            tempId: m.tempId,
            title: `Mock Module (${m.tempId})`,
            description: `Mock module description for ${m.tempId}, standing in for a real LLM-written summary.`,
          })),
          lessons: modulesCtx.flatMap((m) =>
            m.subtopics.map((s) => ({
              subtopicId: s.id,
              title: `Mock Lesson: ${s.title}`,
              description: `Mock lesson description for "${s.title}".`,
              estimatedDuration: "8 min read/listen",
            }))
          ),
        });
      }

      default:
        throw new Error(`[dry-run mock] No canned response registered for task type "${taskType}".`);
    }
  }

  return mockRun;
}

/**
 * Canned fetchAndClean for `npm run harness -- build --dry-run "<topic>"`'s
 * Material Aggregator step. With the fixed 3-subtopic, 2-query-per-pass mock
 * wiring above, "Mock Subtopic Two" always ends up owning mock-source-9
 * through mock-source-12: subtopic One consumes 1-4 on its first research
 * pass, then ANOTHER 4 (5-8) on its forced audit-retry pass (see
 * createMockOrchestratorRun's depth_audit_score case), before subtopic Two
 * starts at 9. Those four (9-12) are deliberately forced "unreachable" here
 * so that lesson lands at 0 valid sources and the backfill trigger actually
 * fires during a dry run, demonstrating that path without spending real
 * API/search calls. Every other source re-fetches as a normal valid article.
 */
export function createMockMaterialFetchAndClean(): FetchAndCleanFn {
  return async (url: string): Promise<CleanedContent> => {
    const match = /mock-source-(\d+)/.exec(url);
    const n = match ? Number(match[1]) : 0;
    if (n >= 9 && n <= 12) {
      return { text: "", title: "", extractionConfidence: 0, sourceType: "unreachable" };
    }
    return {
      text: `Canned mock article text standing in for the real page at ${url}. `.repeat(30),
      title: `Mock title for ${url}`,
      extractionConfidence: 0.9,
      sourceType: "article",
    };
  };
}

/**
 * Canned researchAgent.backfillSubtopic() for the same dry run — returns two
 * fresh, already-valid sources so the demo shows the full backfill arc: a
 * lesson drops below threshold, the targeted re-search "runs" (mocked), and
 * the lesson recovers above threshold rather than shipping flagged. The
 * still-below-threshold-after-backfill branch is covered separately by a
 * unit test (tests/materialAggregator.test.ts), not by this dry-run path.
 */
export function createMockBackfillSubtopic(): BackfillSubtopicFn {
  return async (input: BackfillSubtopicInput): Promise<SourceRecord[]> => {
    const slug = slugify(input.subtopicTitle) || "subtopic";
    return [1, 2].map((n) => ({
      source_id: `src_mock_backfill_${slug}_${n}`,
      url: `https://example.com/mock-backfill-${slug}-${n}`,
      title: `Mock backfilled source ${n} for ${input.subtopicTitle}`,
      text: `Canned mock backfilled article text for "${input.subtopicTitle}", long enough to look like real extracted content. `.repeat(
        20
      ),
      extractionConfidence: 0.85,
      domain: "example.com",
      query: "mock backfill query",
      role: "initial" as const,
    }));
  };
}
