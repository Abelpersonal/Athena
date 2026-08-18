# Teacher — Orchestrator, Search, and the Research Agent

Backend-first plumbing for a personal, single-user AI learning platform.

- **Phase 1** built the two things every later agent depends on: **the Orchestrator**
  (`src/orchestrator/`) — the single gateway every agent uses to call Claude — and **a web
  search adapter** (`src/mcp/`) — Tavily's MCP server behind a small interface.
- **Phase 2 + 2.5** build the **Research Agent** (`src/research/`) on top of Phase 1: a
  multi-pass pipeline that decomposes a topic, researches and synthesizes each subtopic with
  cited sources, self-audits its own depth and retries the subtopics that fall short, and tags
  the topic's volatility. Its output is a structured "course JSON" — subtopics with layered,
  cited content — and nothing else.

There is no Course Builder (module/lesson sequencing, DB persistence), Material Aggregator
persistence, Memory Graph, or frontend here — those are Phase 3 and later. The Research Agent's
output in this phase is written to a local JSON file for inspection, not a database.

## Tech choices

- **TypeScript on Node.js**, as a standalone package (no HTTP server, no framework). It's
  designed to be imported as a library from Next.js API routes in a later phase without rework
  — everything is exported functions/classes, not endpoints.
- **Package manager: npm.** No strong reason to prefer pnpm/yarn for a solo project this size;
  npm ships with Node and needs no extra setup.
- **LLM provider:** swappable via a small `LLMProvider` interface (`src/orchestrator/providers/`)
  — Claude (`@anthropic-ai/sdk`) and Gemini (`@google/genai`) are both implemented, selected via
  `LLM_PROVIDER` (default **`gemini`**). Every `[LLM]` step in both phases routes through
  `orchestrator.run()`, which only ever talks to `LLMProvider` — no other module imports either
  vendor SDK directly. See "Choosing an LLM provider" below.
- **Web search:** Tavily's official MCP server (`tavily-mcp` on npm), run locally via
  `npx -y tavily-mcp` over stdio — see "Swapping the MCP search provider" below. Phase 2 reuses
  this same adapter for both its initial and contention-focused searches; no additional search
  providers (arXiv, YouTube, Consensus, Firecrawl) were added — that's a documented later
  refinement, not a Phase 2 requirement.
- **Content extraction:** Readability.js (`@mozilla/readability` + `jsdom`), in-process
  (`src/extraction/fetchAndClean.ts`). No Trafilatura fallback for low-confidence extractions —
  **deferred, not built** (see "Documented gaps" below); a low-confidence page is simply excluded
  from that subtopic's source set rather than retried through a second extractor.
- **Validation:** Zod, per the original spec. Static per-`taskType` schemas catch shape errors;
  a new **`validateExtra`** hook on `orchestrator.run()` (added in Phase 2) catches call-specific
  constraints a static schema can't express — see "Grounding enforcement" below.
- **Testing:** Vitest. The LLM call is mocked in every test (no real API calls in CI); Phase 2
  additionally injects fake search/extraction dependencies into the pipeline for deterministic
  control-flow tests.
- **Logging:** structured JSONL to a local file — no database. That arrives in Phase 3.5 for
  course data.

## Setup

```bash
npm install
cp .env.example .env
# then fill in GEMINI_API_KEY (default provider) and TAVILY_API_KEY in .env
# — or set LLM_PROVIDER=anthropic and fill in ANTHROPIC_API_KEY instead
```

### Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `LLM_PROVIDER` | No | `gemini` | Which vendor the Orchestrator calls: `gemini` or `anthropic`. |
| `GEMINI_API_KEY` | Yes, if `LLM_PROVIDER=gemini` | — | From [Google AI Studio](https://aistudio.google.com/apikey). |
| `ANTHROPIC_API_KEY` | Yes, if `LLM_PROVIDER=anthropic` | — | From [console.anthropic.com](https://console.anthropic.com/). |
| `TAVILY_API_KEY` | Yes (for search) | — | Passed to the Tavily MCP server subprocess. |
| `ORCHESTRATOR_MODEL` | No | the selected provider's own default (see below) | One-line override to change the model. |
| `ORCHESTRATOR_MAX_RETRIES` | No | `2` | Retries after the first attempt before a hard failure. |
| `ORCHESTRATOR_LOG_PATH` | No | `logs/orchestrator.jsonl` | Where the JSONL cost/latency log is written. |

Pipeline-specific tuning (max audit retries, sources per pass, extraction confidence floor) are
function parameters on `runResearchPipeline()`, not env vars — see "Tuning the pipeline" below.

## Running the harness

```bash
# Phase 1 demo: search -> summarize_text
npm run harness -- "your topic here"

# Phase 2: the full Research Agent pipeline, real APIs, writes output/<topic-slug>.json
npm run harness -- research "your topic here"

# Phase 2, wiring-only: mocked LLM/search/extraction, no API cost, exercises every code path
# (including the audit-retry loop) deterministically
npm run harness -- research --dry-run "your topic here"
```

The Phase 1 form prints a structured, schema-checked `summarize_text` result plus the JSONL log
path — see Phase 1 notes below.

The `research` form is Phase 2's primary quality-checking tool (there's no UI yet): it runs the
full pipeline, writes the resulting course JSON to `output/<topic-slug>.json` for manual
inspection, and prints a per-subtopic summary — audit outcome, whether it needed a retry and why,
and its volatility tier. `--dry-run` swaps in canned responses for the Orchestrator, search, and
extraction (see `src/harness/mocks.ts`) so you can validate the pipeline's control flow — including
a forced audit failure-then-retry on the first subtopic — without spending real API credits. Use
real runs to validate output *quality*; use `--dry-run` to validate *wiring* while iterating.

Both forms need `ANTHROPIC_API_KEY` and `TAVILY_API_KEY` set (except `--dry-run`, which needs
neither). This is meant to be a scrappy debugging tool across Phases 1–6, not a polished CLI.

## Running tests

```bash
npm test          # one-shot
npm run test:watch
npm run typecheck
```

- `tests/orchestrator.test.ts` — mocks `getProvider()` (the vendor-agnostic seam, not a specific
  SDK), forces an invalid response on the first call, and asserts the Orchestrator retries with a
  correction-note prompt and succeeds on the second. Also covers: immediate success, exhausting
  retries and throwing `OrchestratorError`, not retrying a model refusal, and an unregistered task
  type failing fast.
- `tests/providers.test.ts` — mocks `@anthropic-ai/sdk` and `@google/genai` directly (one describe
  block each) to test each `LLMProvider`'s own request/response mapping in isolation: thinking/
  effort translation, refusal/safety → `finishReason: "refusal"`, `max_tokens`/`MAX_TOKENS`
  mapping, Gemini's `thoughtsTokenCount` folded into `outputTokens`, and a missing-fields response
  handled gracefully. Also covers `getProvider()`'s selection logic: defaults to `gemini`, honors
  `LLM_PROVIDER=anthropic`, case-insensitivity, a clear error on an unknown value, and instance
  caching.
- `tests/webSearch.test.ts` — mocks the MCP client/transport; covers successful parsing into
  `SearchResult[]`, a rejected tool call, an MCP-level tool error, an empty query list, and
  non-JSON content — all of which must return an empty/partial array rather than throw.
- `tests/grounding.test.ts` — unit-tests `createCitationValidator` directly, then proves the
  grounding NFR end-to-end through the real Orchestrator + the real `synthesize_subtopic`
  template (provider mocked at the `getProvider()` seam): forces the model to fabricate a
  `source_id` outside the provided set, confirms the Orchestrator retries with the fabricated id
  named in the correction prompt, confirms it succeeds once the model cites only real ids, and
  confirms that if the model *never* self-corrects, the Orchestrator throws rather than ever
  returning the fabricated citation to the caller.
- `tests/extraction.test.ts` — mocks `fetch`; covers `fetchAndClean`'s confidence check: network
  failure, non-2xx response, non-HTML content type, too-little-extractable-text, and confidence
  scaling with article length — all resolving to `{ text: "", title: "", extractionConfidence: 0 }`
  on failure rather than throwing or returning null.
- `tests/research.pipeline.test.ts` — runs `runResearchPipeline()` with a fully injected fake
  Orchestrator/search/extraction, covering: decomposition parsing into unique subtopic ids
  (including a title collision), a subtopic that fails its first audit and passes on retry, a
  subtopic that still fails after exhausting its retry budget and ships flagged
  `shallow_after_retry`, a subtopic that passes immediately with no retry, failing closed
  (`ResearchPipelineError`) when zero usable sources are found, and excluding only the
  below-threshold extractions from a subtopic's source set while keeping the usable ones.

## Architecture

```
src/
  orchestrator/
    index.ts          # public entry point: run(taskType, context, callingModule, options)
    providers/          # LLMProvider interface + Anthropic/Gemini implementations + selection
    templates/           # PromptTemplate registry + every registered task_type
    validate.ts            # Zod validation + retry-prompt construction
    logging.ts               # JSONL cost/latency logger
    pricing.ts                 # per-model $/token table for cost estimation
  mcp/
    webSearch.ts        # Tavily MCP adapter (search only for now)
  extraction/
    fetchAndClean.ts    # Readability.js content extraction, with a confidence score
  research/
    pipeline.ts         # the Research Agent's multi-pass pipeline (Phase 2 + 2.5)
    grounding.ts         # createCitationValidator() — the anti-fabrication check
    types.ts              # CourseJson / SubtopicResult / SourceRecord
  harness/
    cli.ts               # debugging CLI: Phase 1 demo + `research [--dry-run]`
    mocks.ts              # canned dependencies for --dry-run
tests/
  orchestrator.test.ts
  providers.test.ts
  webSearch.test.ts
  grounding.test.ts
  extraction.test.ts
  research.pipeline.test.ts
output/                 # research harness writes course JSON here (gitignored is NOT set —
                         # inspect/delete freely; nothing sensitive lands here)
```

### The Orchestrator pipeline

`run(taskType, context, callingModule, options?)` does exactly what the spec calls for:

1. Look up the `PromptTemplate` registered for `taskType`.
2. Build the user prompt from the template's `buildUserPrompt(context)`.
3. Call the selected `LLMProvider` (`options.model ?? ORCHESTRATOR_MODEL ?? provider.defaultModel`)
   with the template's system prompt — see "Choosing an LLM provider" below.
4. Parse the response as JSON and validate it against the template's Zod `outputSchema`.
5. **(Phase 2 addition)** If it passes the schema, and `options.validateExtra` is given, run that
   too — see "Grounding enforcement" below for why this exists.
6. On either kind of failure: build a retry prompt (original request + a concise note on what was
   wrong) and retry, up to `options.maxRetries ?? ORCHESTRATOR_MAX_RETRIES` (default 2 retries —
   3 attempts total).
7. Log one JSONL record per call: `{ taskType, model, promptVersion, inputTokens, outputTokens,
   estimatedCostUsd, latencyMs, attempts, success, timestamp }`, plus `callingModule` for
   traceability.
8. Return `{ taskType, promptVersion, data, attempts, raw }` on success, or throw
   `OrchestratorError` (which carries `attempts` and `lastRaw`) after exhausting retries.

A model refusal (`stop_reason: "refusal"`) is not retried — that's a policy decision, not a
formatting mistake a retry could fix.

Each template also carries its own `maxTokens`, `effort`, and `thinking` settings, tuned per task
— light/no-thinking for mechanical steps (query generation, key-point extraction), thinking on
for genuinely reasoning-heavy steps (decomposition, synthesis, layering, the depth audit).

### Adding a new prompt template

Create a file in `src/orchestrator/templates/`, define a Zod output schema and a
`buildUserPrompt`, and call `registerTemplate()`:

```ts
// src/orchestrator/templates/myNewTask.ts
import { z } from "zod";
import { registerTemplate } from "./registry.js";

export const MyTaskOutputSchema = z.object({ /* ... */ });

registerTemplate({
  taskType: "my_new_task",
  version: "1.0.0",
  systemPrompt: "…respond with ONLY a JSON object of shape {...}…",
  buildUserPrompt: (context: { /* your context shape */ }) => `…${context.something}…`,
  outputSchema: MyTaskOutputSchema,
  maxTokens: 1024,
  effort: "low",
  thinking: false,
});
```

Then import it (for its registration side effect) from `src/orchestrator/templates/index.ts`.
No switch statement to extend — `registerTemplate` throws if the same `taskType` is registered
twice, so collisions fail loudly at import time rather than silently overwriting.

### Choosing an LLM provider

`src/orchestrator/providers/` exports an `LLMProvider` interface:

```ts
export interface LLMProvider {
  readonly name: string;
  readonly defaultModel: string;
  call(params: LLMCallParams): Promise<LLMCallResult>;
}
```

`AnthropicProvider` and `GeminiProvider` both implement it, translating vendor-specific request
and response shapes (Claude's `thinking`/`output_config`/`stop_reason`, Gemini's
`thinkingConfig`/`usageMetadata`/`finishReason`) into the same `LLMCallParams` in /
`LLMCallResult` out shape — including normalizing both a Claude refusal and a Gemini safety
block to the same `finishReason: "refusal"`, so the Orchestrator's retry loop never needs to know
which vendor answered. `getProvider()` selects and caches one instance based on `LLM_PROVIDER`
(default `"gemini"`); `orchestrator.run()` calls only `getProvider()`, never a vendor SDK
directly, and picks the model as `options.model ?? ORCHESTRATOR_MODEL ?? provider.defaultModel`.

Each provider's own default model:

| Provider | `defaultModel` | Why |
|---|---|---|
| `gemini` | `gemini-3.7-flash` | Google's latest stable Flash-tier model, positioned for "complex coding, agentic workflows" — a mid/high-tier pick, and stable rather than a preview model. |
| `anthropic` | `claude-sonnet-5` | Near-Opus quality on agentic/coding work at roughly a third of Opus 5's price — see the Phase 1 reasoning below. |

Both providers request `application/json` output as a best-effort hint (Gemini's
`responseMimeType`, and system-prompt instructions for Claude), but neither is relied on for
correctness — the Orchestrator's own parse-and-validate-and-retry loop (`validate.ts`) is what
actually enforces schema compliance, and that has to work identically regardless of provider.

To add a third provider, implement `LLMProvider` the same way and add a case to `getProvider()`'s
switch statement — nothing else in the codebase (templates, the research pipeline, tests that
mock at the `getProvider()` seam) needs to change.

### Swapping the MCP search provider

`src/mcp/webSearch.ts` exports a `SearchProvider` interface:

```ts
export interface SearchProvider {
  search(queries: string[]): Promise<SearchResult[]>;
}
```

`TavilyMCPSearchProvider` is the default implementation, and `webSearch()` /
`closeWebSearch()` are convenience functions over a lazily-created default instance. To swap in
a different MCP server (Exa's `web_search_exa`, Firecrawl, etc.) — kept in reserve for a Phase 3
contention pass rather than because Tavily is expected to be replaced — implement
`SearchProvider` with a class that wraps that server's own MCP client the same way
`TavilyMCPSearchProvider` wraps Tavily's. `runResearchPipeline()` also takes a `searchProvider`
option directly, so the Research Agent can be pointed at a different provider (or several, once
that's needed) without touching its own code.

Only the `tavily-search` tool is called. `TavilyMCPSearchProvider` is deliberately one class
wrapping multiple possible tool calls (not one function per tool), so `extract`/`map`/`crawl` can
be added as additional methods later (Phase 3's Material Aggregator) without changing this
class's public shape or the calling code that already depends on `search()`.

`SearchResult.source_id` is generated locally (a short hash of the URL, not something Tavily
returns) so downstream phases have a stable identifier to cite claims back to specific sources;
`fetchAndClean`'s output reuses this same id, so a source's identity is consistent from search
result through cited claim. `SearchResult` also carries an optional `publishedDate` (from
Tavily's `published_date` field, when present) — used by the Research Agent's volatility tagging.

A failed or empty search returns `[]` with a logged warning — `webSearch()` never throws, so a
search outage degrades a caller's context rather than crashing it.

### The Research Agent pipeline

`runResearchPipeline(topic, options?)` in `src/research/pipeline.ts` implements the exact spec
pipeline — every `[LLM]` step is a registered `PromptTemplate` called through
`orchestrator.run()`, every `[MCP]` step is a `SearchProvider.search()` call, every `[code]` step
is plain TypeScript:

1. **Decompose** (`decompose_topic`): topic → `{ prerequisites[], subtopics[] }`. Subtopic ids are
   assigned in code (a slugified title, de-duplicated on collision) rather than trusted from the
   model, so they're guaranteed stable and unique. If decomposition returns 15+ subtopics, a
   warning is logged (the topic likely belongs in Goal/Syllabus mode, Phase 5) but processing
   continues — no goal-detection logic was built.
2. **Per subtopic**, one *research pass* (repeated on audit failure — see step 4):
   - `generate_search_queries` → 2-4 initial queries → `SearchProvider.search()` → `fetchAndClean()`
     the top results (deduped by URL, capped, low-confidence ones excluded and logged).
   - `extract_grounded_key_points`: every key point must cite a real `source_id` from the sources
     just fetched (enforced — see "Grounding enforcement" below). Skipped entirely (no LLM call)
     if the initial search/fetch found zero usable sources.
   - `generate_contention_queries` → 2-4 queries aimed at misconceptions/disagreements/edge cases
     → `SearchProvider.search()` → `fetchAndClean()` those results the same way.
   - `synthesize_subtopic`: combines the grounded key points *and* the raw contention material
     into one cited explanation (an ordered list of claims, each with `source_ids`), plus explicit
     `contentionNotes` describing and resolving any disagreement/misconception found. Fails
     closed (`ResearchPipelineError`) before this step if both search passes found zero usable
     sources at all — there is nothing left to synthesize grounded claims from.
   - `restructure_layers`: reorganizes the cited synthesis into the five depth layers
     (intuition/mechanics/formal/application/frontier), each independently cited.
3. **Depth audit** (`depth_audit_score`): scores the subtopic's layers against four criteria —
   prerequisites covered, misconceptions addressed, goes beyond intro-article depth, all five
   layers present and substantive. `overallPass` is computed in code as the AND of all four
   (never trusted as a model-reported aggregate that could drift from the per-criterion verdicts).
4. **Retry on failure**: a subtopic that fails the audit gets exactly one more full research pass
   (default `maxAuditRetries: 1`, configurable), with every LLM call in that pass told specifically
   *what* was too shallow (the failing criteria's `reason` text, not "try again"). If it still
   fails, it ships anyway, flagged `auditStatus: "shallow_after_retry"` — bounded cost over an
   unbounded retry loop.
5. **Volatility tagging** (`classify_volatility`, code-prepared context): given the domains and
   publish dates of the sources actually used, classifies the subtopic `fast | medium | slow`
   with a one-line justification.
6. **Output**: a `CourseJson` — `{ topic, prerequisites, subtopics[], generatedAt }`, each
   subtopic carrying its sources, synthesis, layers, full audit history, and volatility tag.

#### Grounding enforcement (the no-fabricated-citations NFR)

Every claim in a subtopic's synthesis and layered output must cite a `source_id` that actually
exists in that subtopic's fetched material. Zod's static schema (fixed at template-registration
time) can check "citations are present and shaped correctly" but can't check "this specific id is
one of the ones we actually gave you this call" — the valid set is different every call. Phase 2
adds an optional `validateExtra` hook to `orchestrator.run()` for exactly this: it runs after the
Zod schema passes, and a failure is retried through the *same* correction-note-and-retry path a
schema failure uses (same attempt budget, same mechanism) — not a separate ad-hoc outer loop.

`src/research/grounding.ts`'s `createCitationValidator(validSourceIds, extractCitedIds)` builds
this check for a given call; `extract_grounded_key_points`, `synthesize_subtopic`, and
`restructure_layers` all use it. `tests/grounding.test.ts` proves this holds even when the model
never self-corrects: the Orchestrator throws rather than ever returning a response containing a
fabricated citation.

#### Tuning the pipeline

`runResearchPipeline(topic, options)` accepts (all optional):

| Option | Default | Purpose |
|---|---|---|
| `maxAuditRetries` | `1` | Retries after a subtopic's first depth-audit failure. |
| `maxSourcesPerPass` | `5` | Cap on fetched-and-cleaned sources per search pass (after URL dedup). |
| `minExtractionConfidence` | `0.3` | Below this, `fetchAndClean`'s result is excluded, not used. |
| `searchProvider` | the real Tavily adapter | Swap for a different `SearchProvider`, or a fake for tests. |
| `orchestratorRun` | the real `orchestrator.run` | Swap for a fake — this is what `--dry-run` and the unit tests use. |
| `fetchAndClean` | the real Readability-based one | Swap for a fake — likewise. |
| `onProgress` | none | Callback for live progress lines (what the harness prints). |

### Documented gaps

- **No Trafilatura fallback for low-confidence extractions.** `fetchAndClean` returns a
  confidence score; a low-confidence page is simply excluded from that subtopic's source set
  (logged, not retried through a second extractor). This was explicitly optional for Phase 2 —
  if extraction quality turns out to be a real bottleneck once more real-topic runs are done,
  add it as a second attempt inside `fetchAndClean` when Readability's confidence is low, keeping
  the same `{ text, title, extractionConfidence }` return shape so nothing downstream changes.
- **No additional search providers yet** (arXiv, YouTube, Consensus, Firecrawl) — both the
  initial and contention-focused searches reuse Phase 1's Tavily adapter. This was a deliberate
  scope boundary (see the kickoff prompt): adding source diversity and proving the multi-pass
  synthesis loop are separable problems, and conflating them would have made it harder to tell
  whether a weak result was a synthesis problem or a sourcing problem.

## LLM provider swap (added mid-Phase-2, not in the original kickoff prompt)

Partway through Phase 2, the decision was made to make the Orchestrator's LLM vendor swappable
and default it to Google Gemini rather than Anthropic. This was **not** part of the original
Phase 1 or Phase 2 kickoff prompts (Phase 1's spec explicitly named `@anthropic-ai/sdk`) — it's
recorded here as a deliberate, requested deviation, not an oversight. See "Choosing an LLM
provider" above for the resulting design (an `LLMProvider` interface, `AnthropicProvider` +
`GeminiProvider`, `LLM_PROVIDER` env var). The Orchestrator's public contract
(`run(taskType, context, callingModule, options)`) did not change — every template, the retry/
validation loop, and the entire Research Agent pipeline are unaffected by which vendor is
selected. `tests/providers.test.ts` covers both providers' request/response mapping and the
selection logic directly; `tests/orchestrator.test.ts` and `tests/grounding.test.ts` were moved
to mock the vendor-neutral `getProvider()` seam instead of a specific SDK, so the retry and
grounding-enforcement logic they test is proven vendor-agnostic rather than accidentally
Anthropic-specific.

## Definition of done — status

- [x] Orchestrator retry logic is unit-tested with a mocked LLM call.
- [x] Every LLM call goes through `orchestrator.run()`, which only ever calls the selected
      `LLMProvider` — `@anthropic-ai/sdk` is imported only in
      `src/orchestrator/providers/anthropicProvider.ts`, `@google/genai` only in
      `src/orchestrator/providers/geminiProvider.ts`.
- [x] A JSONL log file accumulates one line per Orchestrator call.
- [x] Grounding constraint unit-tested: synthesis never returns a citation outside the provided
      source set, even after exhausting retries (`tests/grounding.test.ts`).
- [x] New tests cover decomposition parsing, audit scoring/retry logic, and `fetchAndClean`'s
      confidence check.
- [x] `npm run typecheck` clean; all 45 tests pass (`npm test`).
- [x] Nothing in this phase persists to a database, builds course/module/lesson sequencing, or
      touches the Memory Graph.
- [ ] **A real run against a genuinely non-trivial topic, with at least one subtopic that failed
      its first depth audit and passed on retry, demonstrated in the report.** The pipeline,
      `--dry-run` mode, and every code path this requires are built and tested (see the dry-run
      excerpt below) — but this specific item needs a live run against real Gemini (or Anthropic)
      + Tavily APIs, which needs API keys this environment doesn't have configured. See the note
      at the end of this section.

Confirmed via `npm run harness -- research --dry-run "Photosynthesis"` that the full pipeline,
including the audit fail → targeted retry → pass path, executes correctly end-to-end:

```
[research-harness] --- Subtopic 1/2: Mock Subtopic One ---
[research-harness] Subtopic "Mock Subtopic One" — research pass 1...
[research-harness] Subtopic "Mock Subtopic One" FAILED the depth audit on attempt 1: misconceptionsAddressed — Mock: no misconception was explicitly addressed on this pass.
[research-harness] Subtopic "Mock Subtopic One" — research pass 2 (targeted retry)...
[research-harness] Subtopic "Mock Subtopic One" passed the depth audit on attempt 2.
```

**To close out the remaining item:** run `npm run harness -- research "<a real, non-trivial
topic>"` with real `GEMINI_API_KEY` (or `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`) and
`TAVILY_API_KEY` set, inspect `output/<slug>.json`, and confirm at least one subtopic's
`auditPasses` array has more than one entry with the first `overallPass: false`. This will cost
real API credits (multiple LLM calls per subtopic, times however many subtopics, times up to
`maxAuditRetries` audit retries) — pick a topic, not a one-word toy, since decomposition on a
trivial topic may not produce enough subtopics to be a meaningful test.

## Deviations from the spec (documented)

- **LLM vendor is swappable and defaults to Gemini, not Claude** — see "LLM provider swap" above.
  This reverses Phase 1's explicit `@anthropic-ai/sdk`-only spec; it was a deliberate mid-Phase-2
  request, not drift. `ORCHESTRATOR_MODEL` now has no single hardcoded default — it falls back to
  whichever provider's own `defaultModel` is selected (`gemini-3.7-flash` or `claude-sonnet-5`,
  both picked on the same "mid/high-tier, not the cheapest or the flagship" reasoning as Phase 1's
  original Sonnet 5 choice). Set `LLM_PROVIDER=anthropic` to go back to Claude-only.
- Validation is done by parsing the model's raw text as JSON and checking it against a Zod
  schema (rather than relying on either vendor's native structured-output feature), because the
  explicit validate → rewrite-prompt-with-correction-note → retry loop *is* a deliverable being
  tested — forcing schema compliance server-side would make that retry path (and, in Phase 2, the
  grounding-retry path) untestable and pointless, and it would also have to work identically
  across vendors with different native structured-output mechanisms.
- Trafilatura fallback and additional search providers deferred — see "Documented gaps" above.
