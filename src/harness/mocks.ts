import type { OrchestratorResult, RunOptions } from "../orchestrator/index.js";
import type { OrchestratorRunFn } from "../research/pipeline.js";
import type { SearchProvider, SearchResult } from "../mcp/webSearch.js";
import type { CleanedContent } from "../extraction/fetchAndClean.js";

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

      default:
        throw new Error(`[dry-run mock] No canned response registered for task type "${taskType}".`);
    }
  }

  return mockRun;
}
