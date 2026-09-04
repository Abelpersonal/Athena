import type { OrchestratorResult, RunOptions } from "../orchestrator/index.js";
import type { OrchestratorRunFn, BackfillSubtopicInput, FetchAndCleanFn } from "../research/pipeline.js";
import type { SearchProvider, SearchResult } from "../mcp/webSearch.js";
import type { CleanedContent } from "../extraction/fetchAndClean.js";
import type { SourceRecord } from "../research/types.js";
import type { BackfillSubtopicFn } from "../materialAggregator/index.js";
import { slugify } from "../shared/ids.js";
import type { OpenLibraryBookResult } from "../mcp/openLibrary.js";
import type { GutenbergMatch } from "../mcp/gutenberg.js";
import type { SearchOpenLibraryFn, CheckGutenbergFn } from "../continuousLearning/index.js";

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

      case "generate_book_candidates":
        // Deliberately constructed (Phase 6 demo): one verifiable candidate and one
        // "Unverifiable" one, so `suggest --dry-run` (with createMockOpenLibraryProvider below)
        // visibly demonstrates BOTH the persisted-and-verified path and the
        // dropped-as-unverified path, not just the happy path.
        return respond({
          candidates: [
            { title: "Mock Foundational Book", author: "Mock Author", category: "core", rationale: "Mock rationale for the core recommendation." },
            {
              title: "Mock Unverifiable Book (forces the rejection path)",
              author: "Nobody",
              category: "optional_deep_dive",
              rationale: "Demonstrates a candidate that fails Open Library verification and is dropped, never persisted.",
            },
          ],
        });

      case "infer_course_domain":
        return respond({ domain: "Mock Domain" });

      case "generate_next_topic_suggestions":
        return respond({
          deepen: {
            topicName: "Mock Deepen Topic",
            description: "Mock canned deepen suggestion — the natural next step in the same domain.",
            rationale: "Mock rationale for staying in this domain.",
          },
          branch: {
            topicName: "Mock Branch Topic",
            description: "Mock canned branch suggestion — an adjacent or novel domain.",
            domain: "Mock Adjacent Domain",
            rationale: "Mock rationale for branching out.",
          },
        });

      case "generate_recheck_queries":
        return respond({ queries: ["mock recheck query one", "mock recheck query two"] });

      case "compare_findings_to_facts": {
        // Deliberately constructed (Phase 6 demo): cycles through all three real severities
        // (one delta per lesson, up to 3) so a dry run visibly demonstrates minor/moderate/major
        // routing, not just the happy (no-delta) path.
        const lessonsCtx = (context.lessons as Array<{ id: string; title: string }>) ?? [];
        const severities = ["minor", "moderate", "major"] as const;
        const deltas = lessonsCtx.slice(0, 3).map((lesson, i) => ({
          existingFactSummary: `Mock existing fact for "${lesson.title}".`,
          newFindingSummary: `Mock updated finding for "${lesson.title}".`,
          severity: severities[i] ?? "minor",
          explanation: `Mock ${severities[i] ?? "minor"}-severity delta for "${lesson.title}", for dry-run wiring checks.`,
          relatedLessonId: lesson.id,
        }));
        return respond({ deltas });
      }

      case "generate_update_lesson":
        return respond({
          title: "Mock Update: something changed",
          whatChanged: "Mock canned description of what changed, standing in for a real delta explanation.",
          updatedGuidance: "Mock canned corrected guidance for the learner.",
        });

      case "generate_mind_map": {
        // Reads the REAL lessonId values back out of its own context (the same pattern
        // compare_findings_to_facts' mock uses for relatedLessonId) — a dry run's mind map graph
        // genuinely validates against the real persisted lessons, not a canned id that happens to
        // pass by coincidence. A simple chain (each lesson a prerequisite of the next) is enough
        // to demonstrate a real, non-trivial edge set without hand-tuning per dry-run fixture.
        const lessonsCtx = (context.lessons as Array<{ lessonId: string; title: string }>) ?? [];
        const nodes = lessonsCtx.map((l) => ({ lessonId: l.lessonId, conceptLabel: `Mock concept: ${l.title}` }));
        const edges = nodes.slice(1).map((n, i) => ({ source: nodes[i]!.lessonId, target: n.lessonId, type: "prerequisite" as const }));
        return respond({ nodes, edges });
      }

      default:
        throw new Error(`[dry-run mock] No canned response registered for task type "${taskType}".`);
    }
  }

  return mockRun;
}

/**
 * Canned BookAvailabilityProvider for `npm run harness -- suggest --dry-run <course_id>`.
 * Rejects any title containing "Unverifiable" (see createMockOrchestratorRun's
 * generate_book_candidates case above) so the dry run visibly demonstrates the real
 * "candidate found by the model but not confirmed on Open Library -> dropped, never persisted"
 * path, not just the happy path.
 */
export function createMockOpenLibraryProvider(): SearchOpenLibraryFn {
  return async (title: string, author?: string): Promise<OpenLibraryBookResult[]> => {
    if (title.includes("Unverifiable")) return [];
    return [{ title, author: author ?? "Mock Author", workId: "OL_MOCK_1W", editionCount: 5, firstPublishYear: 2020 }];
  };
}

/**
 * Canned FreeTextAvailabilityProvider for the same dry run — reports a free full text ONLY for
 * "Mock Foundational Book", so the demo shows both the "Gutenberg confirmed" and "not on
 * Gutenberg" branches rather than always taking one.
 */
export function createMockGutenbergProvider(): CheckGutenbergFn {
  return async (title: string): Promise<GutenbergMatch | null> => {
    if (title !== "Mock Foundational Book") return null;
    return { gutenbergId: 1, title, url: "https://www.gutenberg.org/ebooks/1" };
  };
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
