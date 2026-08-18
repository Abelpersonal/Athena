# Teacher — Phase 1: Orchestrator + MCP Search Integration

Backend-first plumbing for a personal, single-user AI learning platform. Phase 1 builds only
the two things every later agent (Research, Teaching, Quiz, Practice, Mind Map, Continuous
Learning, Knowledge Update) depends on:

1. **The Orchestrator** (`src/orchestrator/`) — the single gateway every agent uses to call
   Claude. No other module imports `@anthropic-ai/sdk`.
2. **A web search adapter** (`src/mcp/`) — Tavily's MCP server behind a small interface, so
   more MCP servers (arXiv, book lookup, filesystem, alternate search providers) can be added
   later without rearchitecting.

There is no course generation, syllabus logic, teaching/quiz/practice logic, memory graph, or
frontend here — that's Phase 3 and later.

## Tech choices

- **TypeScript on Node.js**, as a standalone package (no HTTP server, no framework). It's
  designed to be imported as a library from Next.js API routes in a later phase without rework
  — everything is exported functions/classes, not endpoints.
- **Package manager: npm.** No strong reason to prefer pnpm/yarn for a solo project this size;
  npm ships with Node and needs no extra setup.
- **LLM provider:** the official `@anthropic-ai/sdk`, model read from `ORCHESTRATOR_MODEL`
  (see below).
- **Web search:** Tavily's official MCP server (`tavily-mcp` on npm), run locally via
  `npx -y tavily-mcp` over stdio — see "Swapping the MCP search provider" below for why and how
  to change this.
- **Validation:** Zod, per the original spec.
- **Testing:** Vitest, with the LLM call mocked so the retry-logic tests don't burn real API
  calls.
- **Logging:** structured JSONL to a local file — no database. That arrives in Phase 3.5 for
  course data.

## Setup

```bash
npm install
cp .env.example .env
# then fill in ANTHROPIC_API_KEY and TAVILY_API_KEY in .env
```

### Required environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | — | Every Orchestrator call needs this. |
| `TAVILY_API_KEY` | Yes (for search) | — | Passed to the Tavily MCP server subprocess. |
| `ORCHESTRATOR_MODEL` | No | `claude-sonnet-5` | One-line swap to change the model everywhere. |
| `ORCHESTRATOR_MAX_RETRIES` | No | `2` | Retries after the first attempt before a hard failure. |
| `ORCHESTRATOR_LOG_PATH` | No | `logs/orchestrator.jsonl` | Where the JSONL cost/latency log is written. |

`ORCHESTRATOR_MODEL` defaults to `claude-sonnet-5` — a mid/high-tier model (near-Opus quality on
coding/agentic work at a third of Opus 5's price), matching the "mid/high-tier for quality, cheap
to swap" requirement. Bump it to `claude-opus-5` for harder tasks, or `claude-haiku-4-5` for
cheap/fast ones, by changing that one line — no code changes.

## Running the test harness

```bash
npm run harness -- "your topic here"
```

This is Deliverable 3: it runs a topic through `webSearch()` to fetch real Tavily results, feeds
the results into the Orchestrator's `summarize_text` task, and prints the structured result plus
the path of the JSONL log line it just wrote. It needs both `ANTHROPIC_API_KEY` and
`TAVILY_API_KEY` set — this is a real end-to-end call against both APIs, not a mock. It's meant
to be a scrappy debugging tool across Phases 1–6, not a polished CLI.

## Running tests

```bash
npm test          # one-shot
npm run test:watch
npm run typecheck
```

`tests/orchestrator.test.ts` mocks `@anthropic-ai/sdk` entirely and forces an invalid response on
the first call, asserting the Orchestrator retries with a correction-note prompt and succeeds on
the second — no real API calls in CI. `tests/webSearch.test.ts` mocks the MCP client/transport
and covers: successful parsing into `SearchResult[]`, a rejected tool call, an MCP-level tool
error, and non-JSON content — all of which must return an empty/partial array rather than throw.

## Architecture

```
src/
  orchestrator/
    index.ts          # public entry point: run(taskType, context, callingModule, options)
    templates/         # PromptTemplate registry + example templates
    validate.ts         # Zod validation + retry-prompt construction
    logging.ts           # JSONL cost/latency logger
    pricing.ts            # per-model $/token table for cost estimation
  mcp/
    webSearch.ts        # Tavily MCP adapter (search only for now)
  harness/
    cli.ts               # Deliverable 3 script
tests/
  orchestrator.test.ts
  webSearch.test.ts
```

### The Orchestrator pipeline

`run(taskType, context, callingModule, options?)` does exactly what the spec calls for:

1. Look up the `PromptTemplate` registered for `taskType`.
2. Build the user prompt from the template's `buildUserPrompt(context)`.
3. Call the model (`ORCHESTRATOR_MODEL`, or `options.model`) with the template's system prompt.
4. Parse the response as JSON and validate it against the template's Zod `outputSchema`.
5. On failure: build a retry prompt (original request + a concise note on what was wrong) and
   retry, up to `options.maxRetries ?? ORCHESTRATOR_MAX_RETRIES` (default 2 retries — 3 attempts
   total).
6. Log one JSONL record per call: `{ taskType, model, promptVersion, inputTokens, outputTokens,
   estimatedCostUsd, latencyMs, attempts, success, timestamp }`, plus `callingModule` for
   traceability.
7. Return `{ taskType, promptVersion, data, attempts, raw }` on success, or throw
   `OrchestratorError` (which carries `attempts` and `lastRaw`) after exhausting retries.

A model refusal (`stop_reason: "refusal"`) is not retried — that's a policy decision, not a
formatting mistake a retry could fix.

Each template also carries its own `maxTokens`, `effort`, and `thinking` settings. The two
example templates disable thinking and run at `effort: "low"`, since summarization/extraction
are not reasoning-heavy tasks — this keeps cost and latency down. A task type that genuinely
needs deeper reasoning should set `thinking: true` and a higher `effort` in its own template.

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

### Swapping the MCP search provider

`src/mcp/webSearch.ts` exports a `SearchProvider` interface:

```ts
export interface SearchProvider {
  search(queries: string[]): Promise<SearchResult[]>;
}
```

`TavilyMCPSearchProvider` is the default implementation, and `webSearch()` /
`closeWebSearch()` are convenience functions over a lazily-created default instance. To swap in
a different MCP server (Exa's `web_search_exa`, Firecrawl, etc.) — kept in reserve for a Phase 2
contention pass rather than because Tavily is expected to be replaced — implement
`SearchProvider` with a class that wraps that server's own MCP client the same way
`TavilyMCPSearchProvider` wraps Tavily's, and swap the instance `webSearch()` delegates to (or
just construct and use that class directly wherever `webSearch()` is currently called — nothing
outside `src/mcp/webSearch.ts` depends on Tavily specifically).

Only the `tavily-search` tool is called in Phase 1. `TavilyMCPSearchProvider` is deliberately one
class wrapping multiple possible tool calls (not one function per tool), so `extract`/`map`/
`crawl` can be added as additional methods later (Phase 3's Material Aggregator) without changing
this class's public shape or the calling code that already depends on `search()`.

`SearchResult.source_id` is generated locally (a short hash of the URL, not something Tavily
returns) so later phases have a stable identifier to cite claims back to specific sources.

A failed or empty search returns `[]` with a logged warning — `webSearch()` never throws, so a
search outage degrades a caller's context rather than crashing it.

## Definition of done — status

- [x] `npm run harness -- "some topic"` runs end-to-end against real APIs (search + LLM) and
      prints a valid, schema-checked result (requires real API keys in `.env`).
- [x] Orchestrator retry logic is unit-tested with a mocked LLM call (`tests/orchestrator.test.ts`).
- [x] Every LLM call goes through `orchestrator.run()` — `@anthropic-ai/sdk` is imported only in
      `src/orchestrator/index.ts`.
- [x] A JSONL log file accumulates one line per Orchestrator call.
- [x] This README documents setup, env vars, harness usage, adding a template, and swapping the
      search provider.
- [x] Nothing here touches course/lesson/quiz data models, a database, or a frontend.

## Deviations from the spec (documented)

- `ORCHESTRATOR_MODEL` defaults to `claude-sonnet-5` rather than an Opus-tier model — see
  "Required environment variables" above for the reasoning (mid/high-tier per the spec's own
  wording, and Sonnet 5 is described as near-Opus quality on the coding/agentic work this
  platform will eventually do, at roughly a third of Opus 5's per-token price). Change one env
  var line to use Opus instead.
- Validation is done by parsing the model's raw text as JSON and checking it against a Zod
  schema (rather than using the Messages API's `output_config.format` structured-outputs
  feature), because the explicit validate → rewrite-prompt-with-correction-note → retry loop
  *is* the Phase 1 deliverable being tested — forcing schema compliance server-side would make
  that retry path untestable and pointless.
