# Athena

A personal, single-user AI learning platform: give it a topic ("Special Relativity") or a goal
("become a full-stack quant"), and it researches real, cited sources, builds a five-layer course
(intuition → mechanics → formal → application → frontier), teaches it with voice narration and
grounded Q&A, quizzes and coaches you through
project/simulation/debate practice, tracks real mastery over time, decomposes a big goal into an
ordered multi-domain path of topics with overlap detection against what you've already mastered,
generates a concept mind map, watches its own content for real-world changes and pushes you an
alert when something material shifts, notices when you've gone quiet and nudges you back once
gently, and installs as an offline-capable PWA on a phone. Ten build phases plus this polish pass
got it there — this README is the full build record, in the order it happened, plus (right below)
a map of the document and an honest account of what's actually been verified versus what's still
outstanding.

Originally built under the working name "Teacher"; renamed to Athena partway through — some older
phase writeups below may still say "Teacher" or refer to the package as `teacher` (`package.json`'s
`name` field is `athena`, matching the current name). This is a naming-history footnote, not a
functional gap.

## Contents

- [Current status (Phase 11 + Source Diversity + Pre-Real-Testing Gap Fixes)](#current-status-phase-11--source-diversity--pre-real-testing-gap-fixes) —
  what's built, what's real-verified vs. dry-run/mocked, what's still genuinely outstanding
- [Tech choices](#tech-choices)
- [Setup](#setup)
- [Running the harness](#running-the-harness)
- [Running tests](#running-tests)
- [Architecture](#architecture) (Phases 1-3.5: Orchestrator, Research Agent, Course Builder,
  Material Aggregator, Memory Graph)
- [Phase 4: the Quiz/Assessment Engine and Practice/Experience Engine](#phase-4-the-quizassessment-engine-and-practiceexperience-engine)
- [Phase 5: the Goal/Career Path Planner](#phase-5-the-goalcareer-path-planner)
- [Phase 6: the Continuous Learning Agent and the Knowledge Update Agent](#phase-6-the-continuous-learning-agent-and-the-knowledge-update-agent)
- [Phase 7: the frontend (Next.js)](#phase-7-the-frontend-nextjs-against-the-real-phase-1-6-backend)
- [Phase 7.5: the Teaching Engine voice layer](#phase-75-the-teaching-engine-voice-layer)
- [Phase 8: the Mind Map Agent, React Flow viewer, and starting menu](#phase-8-the-mind-map-agent-the-react-flow-viewer-and-the-starting-menu)
- [Phase 9: the Motivation/Engagement Layer](#phase-9-the-motivationengagement-layer)
- [Phase 10: Mobile — PWA, offline mode, background sync, and real push](#phase-10-mobile--pwa-offline-mode-background-sync-and-real-push)
- [Phase 11: the polish pass](#phase-11-the-polish-pass) (loading/error boundaries, accessibility,
  lint, README rewrite)
- [Source Diversity: PDF + Video Transcript Support](#source-diversity-pdf--video-transcript-support-a-scoped-addition-not-a-numbered-phase)
  (a scoped addition, not a numbered phase — real PDF/YouTube-transcript extraction, the optional
  citation `locator`, the YouTube URL-routing bug fix)
- [Pre-Real-Testing Gap Fixes](#pre-real-testing-gap-fixes-a-scoped-addition-not-a-numbered-phase)
  (a scoped addition, not a numbered phase — the Goal Planner's missing mind map step, the
  citation `locator` finally persisted and rendered, the `GRAPHITI_MCP_URL` env var gap, the
  dependency audit, and an incidentally-discovered `pdf-parse`/`next dev` bundling bug)
- [LLM provider swap](#llm-provider-swap-added-mid-phase-2-not-in-the-original-kickoff-prompt)
- [Definition of done — status](#definition-of-done--status) (historical, Phases 1-3.5 only —
  each later phase's own "Definition of done" subsection is the record for that phase)
- [Deviations from the spec (documented)](#deviations-from-the-spec-documented)

## Current status (Phase 11 + Source Diversity + Pre-Real-Testing Gap Fixes)

All ten phases on the PRD's roadmap are built and individually tested; Phase 11 was a polish pass,
and "Source Diversity" and "Pre-Real-Testing Gap Fixes" (below) are scoped additions after it, not
new numbered phases — see their own sections below. This is a **summary index**, not a
re-verification — every claim here is a pointer to the fuller, phase-by-phase record already in
this document; when in doubt, the linked phase section is the source of truth.

**What's built, end to end:** topic/goal intake with classify-confirm-override → multi-pass
research with cited, volatility-tagged sources (now including real PDF and YouTube-transcript
sources with an optional page/timestamp citation locator that's now persisted AND rendered in the
Course view, not just HTML articles) → five-layer course persistence → a real per-course concept
mind map generated for a course reached through EITHER the standalone topic flow or a Goal/Path →
a Memory Graph of dated facts and mastery history → tiered quizzes and
project/simulation/debate practice with auto-escalating difficulty → a goal/career Path Planner
with cross-domain ordering and overlap detection → a Continuous Learning Agent (next-topic
suggestions, verified book recommendations) and a Knowledge Update Agent (real-world drift
detection, severity-routed digests) → a full Next.js frontend over all of the above → voice
narration with lock-screen media controls → a fixed self-improvement starting menu → real activity tracking,
momentum streaks, low-friction re-entry, boredom-proofing, and milestone celebration → PWA
installability, explicit offline download, background sync of queued offline actions, and real
Web Push for both PRD-named cases (major knowledge updates, an inactivity nudge).

**Verified live vs. dry-run/mocked — the running themes across every phase, not repeated per item:**

- **The Memory Graph (Graphiti/FalkorDB via Docker Compose) has never been reachable in any
  environment this project has been built in, Phase 3.5 through Phase 11.** Every phase's Memory
  Graph write is real code on a real, tested degrade-and-log path (confirmed live every single
  time: a real connection attempt, a real logged failure, the calling operation still succeeding)
  — but the actual graph writes themselves, and `inspect-graph`'s output, have never been
  confirmed against a live Graphiti instance. See "The Docker verification gap" further down.
- **`TAVILY_API_KEY` has never been set in this environment**, so real (non-mocked) web search —
  and therefore a genuinely real `research`/`build`/`knowledge-update` run — has never been
  exercised end-to-end either; every "real" course build referenced below used
  `--dry-run`'s mocked search/extraction path. `GEMINI_API_KEY` (the default LLM provider) HAS
  been real and working since Phase 6, subject to the Gemini free tier's real daily quota, which
  this project's own testing has hit more than once (documented plainly where it happened, e.g.
  Phase 10's download-route verification).
- **`OPENAI_API_KEY` (Phase 7.5's TTS provider) has never been set**, so real synthesized audio
  has never been generated in this environment — every voice-layer verification used
  `TTS_PROVIDER=browser` (the zero-cost `window.speechSynthesis` stage), which is a real, working,
  differently-verified code path, not a stand-in for the OpenAI path.
- **No real mobile browser or device exists in this environment.** This is the sharpest edge of
  Phase 10 (PWA installability, airplane-mode offline behavior, backgrounded-PWA audio, real push
  delivery to a device) and it remains open after Phase 11's own attempt to close it — see Phase
  10's and Phase 11's own Definition of Done sections for exactly what's independently verified
  instead (real HTTP-level checks, unit tests, and live-confirmed logic against constructed data).
- Every phase's own **"Definition of done"** subsection makes this same distinction explicit for
  that phase's specific deliverables — read the phase section linked above for the real detail
  behind any one claim.

**What's still genuinely outstanding, going into any future work on this project:**

1. A real Docker/Graphiti instance, run once, to confirm the Memory Graph's actual write/query
   behavior beyond its (real, tested) degrade path.
2. A real `TAVILY_API_KEY`, to run one genuinely real (non-dry-run) course build end to end.
3. A real device pass for Phase 10's four still-open items (install, offline, backgrounded audio,
   push delivery) — attempted again in Phase 11 with no real device available either.
4. Real OpenAI TTS audio, generated at least once, to confirm Phase 7.5's Stage 2 path beyond its
   already-real Stage 1 (`browser` mode) verification.

None of these are code gaps — they're real-world verification this sandboxed build environment
has never had the credentials or hardware to close, documented honestly at every phase rather than
asserted away.

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
  control-flow tests. Phase 3's DB-touching tests run against an in-memory SQLite (`getDb(":memory:")`),
  never the real `data/teacher.db`.
- **Logging:** structured JSONL to a local file (Orchestrator calls) plus SQLite (persisted course
  data, from Phase 3 on) — see "The database layer" below.
- **Database: SQLite, via Node's built-in `node:sqlite`, not `better-sqlite3`.** The PRD suggested
  `better-sqlite3` as "a reasonable pick," not a hard requirement, and it needs a native binding
  compiled from source (`node-gyp`) — this environment has no C++ toolchain (no Visual Studio
  Build Tools on Windows), and the installed `better-sqlite3` version ships no prebuilt fallback.
  Node 22+ ships a synchronous SQLite driver (`node:sqlite`'s `DatabaseSync`) that needs no native
  compilation at all, so that's the driver, wired into Drizzle through its generic `sqlite-proxy`
  adapter (a `(sql, params, method) => {rows}` callback — `DatabaseSync.prepare(...).run/all/get`
  with `setReturnArrays(true)` supplies exactly that shape). Everything above the driver — the
  schema, the query builder, transactions — is ordinary `drizzle-orm/sqlite-core`, identical to
  what a `better-sqlite3`-backed setup would use; only `src/db/client.ts` knows which driver is
  underneath. See "Deviations from the spec" below.
- **Schema/migrations: Drizzle + drizzle-kit.** `npx drizzle-kit generate` diffs `src/db/schema.ts`
  against the migration history and writes a new versioned SQL file under `drizzle/` when the
  schema changes — no hand-editing a live DB file, ever. `getDb()` applies any pending migrations
  automatically the first time it's called in a process, so the schema can grow phase-by-phase
  (Phase 4's `QuizResult`/`PracticeAttempt`/`MasteryState`, etc.) without a separate manual
  migration step. The Memory Graph (Phase 3.5, below) is a genuinely separate graph database, not
  more SQLite tables — it doesn't touch this schema at all.
- **Memory Graph: Graphiti on FalkorDB, run as a separate Docker service, reached over MCP.**
  Graphiti (`getzep/graphiti`) turns raw text ("episodes") into a temporal knowledge graph — entity
  nodes, relationship edges as dated facts, automatic supersession when new facts contradict old
  ones — which is exactly the "supersede, don't just append" model Phase 6's delta detection will
  need later. Its own MCP server (not a library Teacher imports) exposes an HTTP endpoint; the
  actual transport is the modern **Streamable HTTP** MCP transport (confirmed by reading
  `getzep/graphiti`'s own server source — legacy SSE is explicitly marked deprecated there), so
  `src/memoryGraph/graphitiClient.ts` uses `StreamableHTTPClientTransport`, not Phase 1's
  `StdioClientTransport` pattern. See "The Memory Graph" below.

## Setup

```bash
npm install
cp .env.example .env
# then fill in GEMINI_API_KEY (default provider) and TAVILY_API_KEY in .env
# — or set LLM_PROVIDER=anthropic and fill in ANTHROPIC_API_KEY instead
```

### Setting up the Memory Graph (Docker)

The Memory Graph runs as a **separate local service** from Teacher's own Node process — Node
can't reliably launch and manage a Docker Compose stack itself for a personal dev setup, so this
is a manual one-time (per machine) step, not something `npm install` or the harness does for you.

```bash
cd mcp_server
cp .env.example .env
# fill in GOOGLE_API_KEY — same value as Teacher's own GEMINI_API_KEY (Graphiti's own config
# reads GOOGLE_API_KEY, not GEMINI_API_KEY; see mcp_server/config.yaml)
docker compose up -d
```

This starts one container (`zepai/knowledge-graph-mcp:latest`, getzep/graphiti's official
pre-built image — Teacher's `docker-compose.yml` references it directly rather than cloning and
building graphiti's own repo) bundling FalkorDB and the Graphiti MCP server together:

- `http://localhost:8000/mcp/` — the MCP endpoint Teacher's `src/memoryGraph/` client connects to
- `http://localhost:8000/health` — health check
- `http://localhost:3000` — FalkorDB's own browser UI, for poking at the raw graph directly
- `redis://localhost:6379` — FalkorDB's Redis-protocol port

Confirm it's up with `curl http://localhost:8000/health`, then run any `npm run harness -- build`
or `npm run inspect-graph` command from Teacher's own root as usual — no other wiring needed.
**This setup has not been run in the environment this code was written in — no Docker is
installed there.** See "The Docker verification gap" near the end of this README.

#### Why FalkorDB, not Neo4j

The PRD names Neo4j, but this deviates to **FalkorDB** deliberately: it's the graphiti Docker
Compose quickstart's own default, and it's meaningfully lighter to run on a single personal
machine (one combined container vs. a separate JVM-based Neo4j service). Neo4j remains a
documented fallback — `getzep/graphiti`'s repo ships a `docker-compose-neo4j.yml` alongside the
FalkorDB one, so switching later is a config swap, not a rewrite, if FalkorDB gives real trouble.

### Environment variables

Teacher's own `.env` (repo root):

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `LLM_PROVIDER` | No | `gemini` | Which vendor the Orchestrator calls: `gemini` or `anthropic`. |
| `GEMINI_API_KEY` | Yes, if `LLM_PROVIDER=gemini` | — | From [Google AI Studio](https://aistudio.google.com/apikey). |
| `ANTHROPIC_API_KEY` | Yes, if `LLM_PROVIDER=anthropic` | — | From [console.anthropic.com](https://console.anthropic.com/). |
| `TAVILY_API_KEY` | Yes (for search) | — | Passed to the Tavily MCP server subprocess. |
| `ORCHESTRATOR_MODEL` | No | the selected provider's own default (see below) | One-line override to change the model. |
| `ORCHESTRATOR_MAX_RETRIES` | No | `2` | Retries after the first attempt before a hard failure. |
| `ORCHESTRATOR_LOG_PATH` | No | `logs/orchestrator.jsonl` | Where the JSONL cost/latency log is written. |
| `TEACHER_DB_PATH` | No | `data/teacher.db` | Override the SQLite file path (`getDb()`'s default parameter). |
| `MATERIAL_MIN_VALID_SOURCES` | No | `2` | Minimum `type: "article"` sources a lesson needs before the Material Aggregator's backfill trigger fires. |
| `GRAPHITI_MCP_URL` | No | `http://localhost:8000/mcp/` | Where `src/memoryGraph/` connects — override if the graph service runs on a different host/port. |
| `QUIZ_QUESTIONS_PER_TIER` | No | `2` | Questions generated per requested tier by the Quiz Engine. |
| `QUIZ_WEAK_CONCEPT_THRESHOLD` | No | `0.6` | Below this `knowledge_score`, a concept node is surfaced in `weakConceptNodes` (Phase 4; not load-bearing yet — see "The Quiz/Assessment Engine" below). |
| `PRACTICE_ESCALATION_CAP` | No | `3` | Max attempts per module before the Practice Engine stops auto-generating harder variants (the cap'th attempt, and every attempt after it, stays at `novel_unguided`). |
| `PATH_HIGH_SCORE_THRESHOLD` | No | `0.75` | Overlap detection (Phase 5): `knowledge_score` at or above this counts as "mastered, high score." |
| `RECHECK_INTERVAL_DAYS_FAST` / `_MEDIUM` / `_SLOW` / `_MIXED` | No | `14` / `60` / `180` / `60` | Phase 6's formalized recheck interval (`getRecheckIntervalDays`, `src/shared/recheckInterval.ts`), shared by Phase 5's overlap detection AND Phase 6's Knowledge Update Agent due-topic selection. Renamed from Phase 5's stopgap `PATH_RECHECK_WINDOW_DAYS_*` (old defaults 30/90/180/90) now that the concept is no longer Phase-5-specific. |
| `DIVERSITY_WINDOW_N` | No | `5` | Continuous Learning Agent (Phase 6): how many recent completed courses' domains to check for clustering. |
| `DIVERSITY_CLUSTER_THRESHOLD` | No | `0.6` | Continuous Learning Agent (Phase 6): the top domain's share (of the diversity window) at/above which the branch suggestion is biased toward diversity. |

`mcp_server/.env` (separate file, the Graphiti service's own config — not read by Teacher's Node
process at all):

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `GOOGLE_API_KEY` | Yes | — | Graphiti's own internal LLM + embedding calls (entity/fact extraction from episodes). Same key value as Teacher's `GEMINI_API_KEY`, different env var name (Graphiti's config expects `GOOGLE_API_KEY`). |
| `MODEL_NAME` | No | `gemini-3.7-flash` | Overrides `mcp_server/config.yaml`'s LLM model. |
| `EMBEDDER_MODEL` | No | `gemini-embedding-001` | Overrides the embedding model. |
| `SEMAPHORE_LIMIT` | No | `10` | Episode processing concurrency — lower this if you hit 429s. |
| `GRAPHITI_GROUP_ID` | No | `main` | Namespaces graph data. Left at one shared default deliberately — see "The Memory Graph" below. |
| `FALKORDB_PASSWORD`, `FALKORDB_DATABASE`, `BROWSER` | No | blank, `default_db`, `1` | FalkorDB tuning; `BROWSER=0` disables the :3000 UI. |

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

# Phase 3: research -> Course Builder -> Material Aggregator, real APIs, writes to data/teacher.db
npm run harness -- build "your topic here"

# Phase 3, wiring-only: fully mocked, no API cost, writes to the isolated data/teacher.dry-run.db
npm run harness -- build --dry-run "your topic here"

# Dump a persisted course's structure (modules, lessons, source counts) from SQLite
npm run inspect -- <course_id>
npm run inspect -- --dry-run <course_id>   # reads data/teacher.dry-run.db instead

# Dump whatever's stored for a topic in the Memory Graph (Phase 3.5) — nodes, facts,
# episodes, dates. Needs `docker compose up` running in mcp_server/ (see Setup above).
npm run inspect-graph -- "your topic here"

# Phase 4: run a quiz session against one already-persisted lesson, real APIs. Prompts for
# each question via the CLI (a number for multiple-choice, free text otherwise), then prints
# per-tier and overall scores plus the updated MasteryState row. Omit [tier] to test all three.
npm run harness -- quiz <lesson_id> [recall|application|transfer]

# Phase 4: run a practice session against one already-persisted module, real APIs. Prints the
# generated task/scenario/claim; for "simulation"/"debate" formats this is a real multi-turn
# CLI dialogue (type your reply each turn, "/end" to finish) — for "project" it's a multi-line
# submission ended with a line containing only "/done". Then prints the critique, a reflection
# prompt (captured the same way), and the updated MasteryState.experience_score.
npm run harness -- practice <module_id>

# Phase 5: classify raw input as a topic or a goal (CLI-confirmed — you can override the model's
# call), real APIs. A topic classification runs the existing build pipeline unchanged. A goal
# classification decomposes into a cross-domain roadmap, runs overlap detection against
# MasteryState/the Memory Graph, prints the annotated roadmap, then loops letting you pick a
# generatable pending/delta_needed topic to generate next (looping back to the roadmap after each).
npm run harness -- goal "<input>"

# Phase 6: the Continuous Learning Agent — only runs on a course already marked complete
# (courses.completedAt set by real quiz activity, see "Completion trigger" below). Verifies every
# book candidate via Open Library/Gutenberg before persisting it; prints a deepen + a branch
# next-topic suggestion (never persisted — recomputed fresh every run).
npm run harness -- suggest <course_id>
npm run harness -- suggest --dry-run <course_id>

# Phase 6: the "what's new" digest — reads whatever `npm run knowledge-update` has already written.
npm run harness -- whats-new
npm run harness -- whats-new --include-minor

# Phase 6: the Knowledge Update Agent's standalone scheduled-job script (see its own section below
# for the full writeup and a crontab wiring example) — NOT a harness subcommand, its own npm script.
npm run knowledge-update
npm run knowledge-update -- --dry-run
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

The `build` form chains all three Phase 3 stages: it runs the research pipeline (same as `research`,
just not written to `output/`), hands the result to `buildCourse()`, then to `aggregateMaterials()`,
and prints `course_id`, module/lesson counts, persisted-source count, and how many lessons
triggered a backfill. As of Phase 3.5, `buildCourse()` also writes the topic + prerequisites to the
Memory Graph, and `aggregateMaterials()` writes each subtopic's grounded key points there too —
both degrade to a logged error rather than failing the whole `build` command if the graph service
isn't reachable (e.g. `docker compose up` isn't running — see Setup). `--dry-run` mocks every
dependency (LLM, search, extraction, `researchAgent.backfillSubtopic()`, and both Memory Graph
writes) and, importantly, **writes to a separate `data/teacher.dry-run.db` file** rather than the
real `data/teacher.db` — mock course data (titled "Mock Module (m1)" etc.) should never land in
the DB you'd actually inspect real courses in. `npm run inspect` needs the same `--dry-run` flag to
read that same isolated file.

All real (non-`--dry-run`) `research`/`build` forms need `TAVILY_API_KEY` set, plus either
`GEMINI_API_KEY` (default provider) or `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`. `build`
additionally talks to the Memory Graph service (see Setup) when not run with `--dry-run`, though a
missing graph service degrades rather than fails the command. `quiz`/`practice` (Phase 4) need only
an LLM key (no `TAVILY_API_KEY` — they don't search the web) plus a lesson/module id that's
already persisted, from any prior `build` or `build --dry-run` run; they also talk to the Memory
Graph the same way `build` does. This is meant to be a scrappy debugging tool across
Phases 1–6, not a polished CLI.

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
- `tests/extraction.test.ts` — mocks `fetch`; covers `fetchAndClean`'s confidence check and its
  `sourceType` classification (Phase 3 addition): network failure and non-2xx → `"unreachable"`,
  PDF/video/other non-HTML content types → `"pdf"`/`"video"`/`"other"`, reachable HTML with no
  extractable article or too-little text → `"low_confidence"`, and a real substantive article →
  `"article"` with positive confidence.
- `tests/research.pipeline.test.ts` — runs `runResearchPipeline()` with a fully injected fake
  Orchestrator/search/extraction, covering: decomposition parsing into unique subtopic ids
  (including a title collision), a subtopic that fails its first audit and passes on retry, a
  subtopic that still fails after exhausting its retry budget and ships flagged
  `shallow_after_retry`, a subtopic that passes immediately with no retry, failing closed
  (`ResearchPipelineError`) when zero usable sources are found, and excluding only the
  below-threshold extractions from a subtopic's source set while keeping the usable ones.
- `tests/courseBuilder.test.ts` — `topoSortModules()` unit tests (a real prerequisite edge
  reorders modules away from the model's declared array order; unrelated modules keep their
  original order; a genuine cycle throws `CourseBuilderError`; self-referencing and dangling
  edges are ignored rather than crashing), plus `buildCourse()` integration tests against an
  in-memory SQLite db — persisted module order/`prerequisiteOf` reflecting a real dependency
  chain, `writeTopicToMemoryGraph` being called with the right `courseId`/`topic`/prerequisites,
  and two builds of similarly-titled courses against the same db not colliding on id uniqueness
  (the real bug the run-scoped id suffix — see "The Course Builder" below — was added to fix).
- `tests/courseBuilderTemplates.test.ts` — unit-tests `createSequenceModulesValidator` and
  `createWriteLessonMetadataValidator` directly (coverage/uniqueness/unknown-id/dangling-edge
  rejection, mirroring `grounding.test.ts`'s pattern for the Phase 2 validators).
- `tests/materialAggregator.test.ts` — `aggregateMaterials()` against an in-memory db seeded via a
  real `buildCourse()` call: Source persistence and lesson-linking, the backfill trigger firing
  exactly once when a lesson lands below threshold and recovering above it, a lesson still short
  after its one backfill attempt shipping flagged `source_status: "below_threshold"` (mocked
  failing-source case — no real API/search calls), the course's `status` flipping to `"complete"`,
  two subtopics citing the identical URL not crashing on the Source table's primary key
  (`onConflictDoNothing()`), and `writeSubtopicFacts` being called once per subtopic with the right
  `courseId`/`subtopicId`/`keyPoints`.
- `tests/memoryGraph.test.ts` — mocks `@modelcontextprotocol/sdk`'s `Client` and
  `StreamableHTTPClientTransport` directly (no Docker needed in CI): `writeTopic`'s call shape
  (one `add_memory` episode plus one `add_triplet` per prerequisite, and still writing the episode
  when there are zero prerequisites), `writeSubtopicFacts`'s call shape (one `add_memory` per key
  point, each JSON-encoding `{point, source_id}`), graceful degradation on a simulated connection
  failure for both write paths (resolves without throwing, logs loudly), `getTopicHistory`
  combining `search_nodes`/`search_memory_facts`/`get_episodes` into one result or returning
  `{nodes: [], facts: [], episodes: [], error}` rather than throwing when the graph is unreachable,
  and (Phase 4) `writeMasteryUpdate`'s call shape — one `add_memory` episode per call (a new dated
  fact, never an overwrite), the episode name/body correctly distinguishing `"knowledge"` from
  `"experience"` updates, and the same graceful-degradation behavior on a connection failure.
- `tests/quizEngine.test.ts` (Phase 4) — `generateQuizQuestions`: all three tiers requested by
  default and tagged correctly on the returned questions, only the tiers actually passed are
  requested from the Orchestrator, every call is grounded in the lesson's real persisted
  title/description/layers (not a generic prompt), the multiple_choice/free_text question shapes
  round-trip correctly, and an unknown lesson id throws `QuizEngineError`.
  `scoreAndRecordQuiz`: multiple_choice questions are scored in code with zero LLM calls while
  free_text questions trigger exactly one `score_free_text_answer` call each — proven with a
  known-good answer (mocked to score 0.9) and a known-bad answer (mocked to score 0.1) and
  asserting the returned scores land where expected, one `QuizResult` row is persisted per tier
  tested, `MasteryState.knowledgeScore` is upserted via a targeted column update that leaves a
  pre-existing `experienceScore` untouched, weak concept nodes are surfaced below (and only below)
  the configured threshold, and the Memory Graph mirror is called once with the right concept node
  id, `"knowledge"` type, and score.
- `tests/practiceEngine.test.ts` (Phase 4) — `difficultyForAttemptNumber` unit tests (attempt 1 is
  `guided`, attempt 2 is `harder`, the cap'th attempt and every attempt after it is
  `novel_unguided` — proving the "stops escalating" cap behavior directly, not just via
  integration). `preparePracticeSession`: both `classify_topic_type` branches exercised against
  independent mocked responses (a skill-based module producing `project` content, a conceptual
  module producing `debate` content), an unknown module id throwing `PracticeEngineError`, and
  attempt-number/prior-mistakes threading — a seeded prior `PracticeAttempt` row correctly bumps
  `attemptNumber` to 2, escalates `difficulty` to `harder`, and threads that attempt's `feedback`
  into the next content-generation call's `priorMistakes` context. `runDialogueTurn` routes a
  simulation turn through `dialogue_turn` with the persona and running history, and rejects a
  project-format session (no dialogue content) with `PracticeEngineError`.
  `critiquePracticeAttempt` asserts the learner's actual submission text reaches the critique call
  and comes back referenced in the critique — the PRD's "not a templated response" quality bar,
  checked directly rather than only via a schema shape. `recordPracticeAttempt`: persists the
  `PracticeAttempt` row correctly, updates `MasteryState.experienceScore` for every lesson in the
  module while leaving each lesson's pre-existing `knowledgeScore` untouched, calls the Memory
  Graph mirror once per lesson with `"experience"` type, and reports
  `willEscalateNextAttempt: false` once the cap is reached.
- `tests/pathPlannerOrdering.test.ts` (Phase 5) — `computeCrossDomainOrder()` unit tests, pure, no
  LLM involved: a topic in one domain that depends on a topic in a DIFFERENT domain lands at a
  strictly later tier (the actual cross-domain case this function exists for), topics with no
  dependency between them share one tier and `parallelGroup` even across domains, a longer
  dependency chain assigns tiers correctly (including taking the max across multiple
  dependencies), a genuine cycle throws `PathPlannerError`, and self-referencing/dangling edges are
  ignored rather than crashing (mirrors `topoSortModules`' tests).
- `tests/pathPlannerOverlap.test.ts` (Phase 5) — `decideOverlapBranch()` unit tests, pure, hitting
  every branch directly by constructing candidate objects (no DB, no LLM, no Memory Graph): no
  matching course, a match below the high-score threshold, a match with no quiz history at all, an
  angle mismatch taking precedence over recency even when the match is fresh, no mismatch when the
  candidate has no `goalContext` or a matching one, within-window vs. past-window recency by
  volatility tier, and a `null` `lastUpdated` treated as infinitely stale.
  `extractCourseIdsFromHistory()` unit tests (recovers a `course_id` from real Memory Graph episode
  text shapes, and returns `[]` when none is present). `resolveOverlapForTopic()` integration tests
  with `findCandidateCourse`/`getExistingLessonTitles` mocked (per the PRD's "mock the Memory Graph
  query" instruction) hitting all four PRD scenarios end-to-end, including both quick-refresh
  outcomes as their own distinct case (a mocked `orchestratorRun` returning `stillAccurate: true` vs.
  `false`) — not just the four `status` values, since two scenarios both resolve to
  `linked_existing` but via genuinely different code paths.
- `tests/pathPlanner.test.ts` (Phase 5) — `classifyInput` boundary cases (a clear single-topic
  input classified `"topic"`, a clear broad input classified `"goal"`, with the raw input verified
  to reach the Orchestrator call unchanged). `decomposeAndPersistPath` integration test against an
  in-memory db with a REAL cross-domain dependency in the mocked `determine_cross_domain_dependencies`
  response (a Programming-domain topic depending on a Math-domain topic) — asserts every persisted
  `PathTopic` has `course_id: null`/`status: "pending"`, and that the dependent topic's persisted
  `order` is strictly greater than its cross-domain prerequisite's. `runOverlapDetectionForPath`
  persists each topic's resolved status/`course_id` and returns the annotated roadmap; an unknown
  path id throws `PathPlannerError`. `isTopicGeneratable` unit tests covering the tier-gating rule
  directly: a blocked tier-1 topic, the same topic unblocked once every tier-0 topic is
  `linked_existing`, same-`parallelGroup` topics never blocking each other even mid-tier, and an
  already-`linked_existing`/`mastered`/`in_progress` topic never itself being "generatable" again.
  `generateTopicCourse` (mocked `runResearchPipelineFn`/`buildCourseFn`/`aggregateMaterialsFn`,
  same dependency-injection pattern as everywhere else): a pending topic's course_id/status update
  and unmodified topic string, a `delta_needed` topic's narrowly-reframed topic string (asserted to
  differ from the bare topic name) and `wasDelta: true`, refusing (throwing `PathPlannerError`,
  with zero pipeline calls made and no DB mutation) to generate a topic blocked by an earlier
  unfinished tier — the ordering guard enforced directly inside the function, not just left to the
  harness's own topic-picking UI — and an unknown `PathTopic` id also throwing.
- `tests/pathPlannerTemplates.test.ts` (Phase 5) — `createDecomposeGoalIntoPathValidator` and
  `createDetermineCrossDomainDependenciesValidator` unit tests (coverage/uniqueness/unknown-reference/
  self-dependency rejection), mirroring `courseBuilderTemplates.test.ts`'s pattern for the Phase 3
  validators.

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
    fetchAndClean.ts    # Readability.js content extraction, with a confidence score + sourceType
  research/
    pipeline.ts         # the Research Agent's multi-pass pipeline (Phase 2 + 2.5) + backfillSubtopic()
    grounding.ts         # createCitationValidator() — the anti-fabrication check
    types.ts              # CourseJson / SubtopicResult / SourceRecord
  courseBuilder/         # Phase 3: sequencing + persistence
    index.ts               # buildCourse() — orchestrates both [LLM] steps, assembles + persists rows
    sequence.ts               # topoSortModules() — pure topological sort, no I/O
  materialAggregator/    # Phase 3: source persistence + backfill
    index.ts               # aggregateMaterials() — re-fetch, persist, link, backfill-trigger
  memoryGraph/            # Phase 3.5: the Memory Graph client
    index.ts                # writeTopic() / writeSubtopicFacts() / getTopicHistory() / writeMasteryUpdate() (Phase 4) — public API
    graphitiClient.ts          # GraphitiMCPClient — MCP connection + tool-call plumbing
    types.ts                    # TS mirrors of Graphiti's response TypedDicts
  quizEngine/             # Phase 4: the Quiz/Assessment Engine
    index.ts                # generateQuizQuestions() / scoreAndRecordQuiz() — public API
  practiceEngine/         # Phase 4: the Practice/Experience Engine
    index.ts                # preparePracticeSession() / runDialogueTurn() / critiquePracticeAttempt() / generateReflectionPromptText() / recordPracticeAttempt() — public API
  pathPlanner/            # Phase 5: the Goal/Career Path Planner
    index.ts                # classifyInput() / decomposeAndPersistPath() / runOverlapDetectionForPath() / loadPathRoadmap() / isTopicGeneratable() / generateTopicCourse() — public API
    ordering.ts                # computeCrossDomainOrder() — pure cross-domain topological tiering, no LLM/DB
    overlap.ts                  # decideOverlapBranch() (pure) + resolveOverlapForTopic() — overlap detection against MasteryState + the Memory Graph
  db/                     # SQLite (node:sqlite) + Drizzle
    schema.ts                # courses (+ goal_context, Phase 5) / modules / lessons / sources / quizResults / practiceAttempts / masteryState (Phase 4) / paths / pathDomains / pathTopics (Phase 5) tables
    client.ts                  # getDb() — lazy connect + auto-migrate, sqlite-proxy driver
  shared/
    ids.ts                # slugify() / assignUniqueIds() — shared by pipeline.ts and courseBuilder
  harness/
    cli.ts               # debugging CLI: Phase 1 demo + `research [--dry-run]` + `build [--dry-run]` + `quiz`/`practice` (Phase 4) + `goal` (Phase 5)
    inspect.ts             # `npm run inspect -- <course_id>` — dumps a persisted course from SQLite, incl. QuizResult/PracticeAttempt/MasteryState (Phase 4)
    inspectGraph.ts          # `npm run inspect-graph -- "<topic>"` — dumps Memory Graph history
    mocks.ts              # canned dependencies for --dry-run (research AND build); also reused by Phase 5's on-demand generation demo (see "Definition of done — Phase 5")
tests/
  orchestrator.test.ts
  providers.test.ts
  webSearch.test.ts
  grounding.test.ts
  extraction.test.ts
  research.pipeline.test.ts
  courseBuilder.test.ts
  courseBuilderTemplates.test.ts
  materialAggregator.test.ts
  memoryGraph.test.ts
  quizEngine.test.ts        # Phase 4
  practiceEngine.test.ts    # Phase 4
  pathPlannerOrdering.test.ts    # Phase 5
  pathPlannerOverlap.test.ts     # Phase 5
  pathPlanner.test.ts            # Phase 5
  pathPlannerTemplates.test.ts   # Phase 5
drizzle/                 # versioned migration SQL, generated by `npm run db:generate` — committed
drizzle.config.ts
mcp_server/              # Docker Compose for Graphiti + FalkorDB (Phase 3.5) — see Setup above
  docker-compose.yml        # references zepai/knowledge-graph-mcp:latest directly, no build step
  config.yaml                # Teacher's override: llm/embedder provider = gemini, database = falkordb
  .env.example
  .env                       # gitignored — GOOGLE_API_KEY etc.
output/                 # research harness writes course JSON here (gitignored)
data/                   # data/teacher.db (real) and data/teacher.dry-run.db (mock) — gitignored
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

### The database layer (SQLite + Drizzle)

`src/db/schema.ts` defines Phase 3's four tables, Phase 4's three, and Phase 5's three — `Book` and
`UpdateEvent` belong to later phases and aren't modeled yet, so the schema grows incrementally
instead of drifting ahead of what's built:

| Table | Columns |
|---|---|
| `courses` | `id`, `topic`, `created_at`, `volatility_tier` (`fast`\|`medium`\|`slow`\|`mixed`, aggregated from subtopic tiers), `status` (`building`\|`complete`), `goal_context` (nullable, Phase 5 — see "Goal-scoped depth" below) |
| `modules` | `id`, `course_id`, `title`, `description`, `order` (DB column `order_index` — sidesteps the SQL reserved word, JS field stays `order`), `prerequisite_of` (JSON array of module ids) |
| `lessons` | `id`, `module_id`, `title`, `description`, `estimated_duration`, `layers` (JSON — same shape as Phase 2's `RestructureLayersOutput["layers"]`), `source_refs` (JSON array of source ids), `audio_cache_ref` (nullable, unused until the audio-caching phase — the column exists now so the schema doesn't change later), `source_status` (`ok`\|`below_threshold`) |
| `sources` | `id`, `url`, `type` (`article`\|`pdf`\|`video`\|`other`\|`unreachable`\|`low_confidence`), `extracted_text`, `credibility_score`, `fetched_at` |
| `quiz_results` (Phase 4) | `id`, `lesson_id`, `tier` (`recall`\|`application`\|`transfer`), `score` (0-1 real), `date` — one row per (lesson, tier) tested in a quiz session, not per question |
| `practice_attempts` (Phase 4) | `id`, `module_id`, `type` (`project`\|`simulation`\|`debate`), `attempt_number`, `feedback`, `reflection_notes` (nullable), `date` |
| `mastery_state` (Phase 4) | `concept_node_id` (primary key), `knowledge_score` (0-1 real, nullable), `experience_score` (0-1 real, nullable), `last_updated` — see "The Quiz/Assessment Engine" and "The Practice/Experience Engine" below for how the two score columns are kept independent |
| `paths` (Phase 5) | `id`, `goal_description`, `created_at`, `status` (`active`\|`completed`) |
| `path_domains` (Phase 5) | `id`, `path_id`, `name`, `order` (DB column `order_index`, same reserved-word dodge as `modules`) |
| `path_topics` (Phase 5) | `id`, `path_id`, `domain_id`, `topic_name`, `description`, `order` (a cross-domain topological TIER, not a per-topic unique sequence), `parallel_group`, `course_id` (nullable — null until generated/linked), `status` (`pending`\|`linked_existing`\|`delta_needed`\|`in_progress`\|`mastered`) — this is an **original design filling a real PRD gap**, not a literal spec table; see "The Path data model" below for the full writeup |

`npm run db:generate` (`drizzle-kit generate`) diffs `schema.ts` against `drizzle/`'s migration
history and writes a new versioned SQL file when the schema changes — run it after editing
`schema.ts`, then commit the generated file. `getDb()` (`src/db/client.ts`) applies any pending
migrations automatically the first time it's called in a process (`drizzle-orm/sqlite-proxy/migrator`),
so there's no separate manual migration step and no live DB file ever needs hand-editing.

`getDb(dbPath?)` defaults to `data/teacher.db` (override via `TEACHER_DB_PATH` or the parameter
directly — tests pass `":memory:"`) and caches one connection per path. `resetDbCache()` clears
that cache — call it before opening a different path in the same process (the harness's
`--dry-run` build mode does this to switch to `data/teacher.dry-run.db`).

### The Course Builder

`buildCourse(course: CourseJson, options?)` in `src/courseBuilder/index.ts` implements the spec's
six steps:

1. **`sequence_modules` [LLM]**: groups subtopics into modules and records a *dependency graph*
   between them (`prerequisiteOfTempIds` edges) — not yet a linear order. The model is not trusted
   to hand back a self-consistent total order directly (same philosophy as Phase 2's depth audit
   computing `overallPass` in code rather than trusting a model-reported aggregate).
2. **`write_lesson_metadata` [LLM]**: given the sequencing from step 1, writes final module/lesson
   titles, short descriptions, and a rough estimated duration (e.g. `"12 min read/listen"` — not a
   word-count formula, per the spec's resolved default).
3. **Assemble records [code]**: `src/courseBuilder/sequence.ts`'s `topoSortModules()` runs Kahn's
   algorithm over step 1's dependency graph to derive the actual linear module order (ties broken
   by the model's original array position, so it's deterministic) — throwing `CourseBuilderError`
   if the edges describe a genuine cycle, rather than silently guessing an order. IDs are minted as
   `{prefix}_{slugified-title}_{run-scoped-random-suffix}` — the shared suffix (not just the
   per-call `assignUniqueIds()` de-dup) is what lets two builds with similar or identical titles
   (a re-run of the same topic, or the dry-run harness's fixed "Mock Module"/"Mock Lesson" titles)
   coexist in the same DB without a `UNIQUE constraint` collision; this was a real bug caught by
   running the dry-run harness twice in a row against the same file — see `tests/courseBuilder.test.ts`.
4. **Persist [code]**: one `db.transaction()` inserts the `Course` row, then every `Module` row,
   then every `Lesson` row (with `source_refs: []`, `source_status: "ok"` — the Material Aggregator
   fills those in) — all-or-nothing, so a failure partway through never leaves an orphaned module
   with no course or a lesson with no module.
5. **Memory Graph write [code]**: calls `memoryGraph.writeTopic(courseId, course.topic, prerequisites)`
   right after persistence succeeds — see "The Memory Graph" below.
6. **Output**: `{ courseId, moduleCount, lessonCount, subtopicLessonMap }` — the last field (a
   `subtopic id -> lesson id` map) is what the Material Aggregator needs to link sources to the
   right lesson.

The depth-audit checkpoint the PRD mentions for course finalization is already satisfied by Phase
2's per-subtopic audit loop and is not reimplemented here.

### The Material Aggregator

`aggregateMaterials(courseId, course, subtopicLessonMap, options?)` in
`src/materialAggregator/index.ts` makes Phase 2's ephemeral, per-subtopic source lists into
persisted, lesson-linked `Source` rows:

1. **Re-fetch and verify [code]**: every source URL a subtopic's research pass collected gets
   `fetchAndClean()`'d again — a fresh copy for permanent storage, not a reuse of Phase 2's
   in-memory text, since that fetch may be stale by the time this stage runs.
2. **Classify honestly, not fabricate a paywall detector [code]**: `fetchAndClean` now returns a
   `sourceType` (`"article" | "pdf" | "video" | "other" | "unreachable" | "low_confidence"`)
   grounded in what was actually observed — `"unreachable"` only for a genuine fetch/network
   failure, `"pdf"`/`"video"`/`"other"` from the real Content-Type header, `"low_confidence"` when
   HTML was reached and read but Readability found nothing usable (commonly caused by paywalls,
   login walls, or JS-rendered pages — but that specific cause is never asserted, since it isn't
   actually detected). Only `"article"` counts toward the valid-source threshold.
3. **Persist and link [code]**: every re-fetched source (including unreachable/low-confidence
   ones — kept for auditability, not silently dropped) is inserted into `sources` and its id
   appended to the lesson's `source_refs`. Inserts use `onConflictDoNothing()`: `source_id` is a
   content hash of the URL (`src/mcp/webSearch.ts`), so the same real URL — cited by two
   subtopics, rediscovered by a backfill, or persisted again in a later `build` run over the same
   DB — always maps to the same id, and that's expected, not a bug (`tests/materialAggregator.test.ts`
   covers this directly).
4. **Backfill trigger [code, delegating to Phase 2]**: if a lesson's `"article"`-type source count
   is below `MATERIAL_MIN_VALID_SOURCES` (default 2), exactly one targeted backfill runs via
   `researchAgent.backfillSubtopic()` — a new export from `src/research/pipeline.ts` that reuses
   (via a shared internal `gatherSources()` helper, factored out of `researchPass()` rather than
   duplicated) steps 2a-2f: two more search+extract passes for just that subtopic, no
   re-synthesis, no re-audit. This is the one place Phase 3 reaches back into the Research Agent.
   Backfilled sources are persisted directly (their own `fetchAndClean` already ran as part of the
   backfill and already filtered to usable-confidence results, so they aren't re-fetched a third
   time). If still below threshold after that one attempt, the lesson ships anyway flagged
   `source_status: "below_threshold"` — bounded cost over an unbounded retry loop, mirroring
   Phase 2's audit-retry policy.
5. **Memory Graph write [code, Phase 3.5]**: right after a subtopic's lesson row and sources are
   persisted (real, DB-backed ids now exist for every `source_id`), `memoryGraph.writeSubtopicFacts()`
   writes that subtopic's grounded key points to the graph — see "The Memory Graph" below.
6. **Finish [code]**: once every subtopic is processed, the course's `status` flips from
   `"building"` to `"complete"`.

No LLM calls happen in this module's own code — the one exception is delegating to
`backfillSubtopic()`, which does call the Orchestrator (as part of Phase 2's pipeline) as the
deliberate, spec'd reach-back described above, not a violation of that rule.

### The Memory Graph (Phase 3.5)

`src/memoryGraph/index.ts` is the only module that touches Graphiti's MCP protocol directly — the
same "one gateway" pattern as the Orchestrator for LLM calls and `SearchProvider` for web search.
It replaces Phase 3's `writeTopic()` stub exactly at its Course Builder call site (one added
parameter, `topic` — the stub only took `courseId`/`prerequisites`) and adds two more functions:

- **`writeTopic(courseId, topic, prerequisites)`** — called from `buildCourse()` right after
  persistence succeeds. Writes an `add_memory` episode describing the course (so a Topic entity
  gets created via Graphiti's own extraction even when there are zero prerequisites — an
  `add_triplet` call always needs two named endpoints, so it can't create a bare node on its own),
  then one **`add_triplet`** call per prerequisite: a precise, synchronous
  `topic -[REQUIRES_PREREQUISITE]-> prerequisite` edge, written directly rather than hoping the
  model infers the same relationship from prose.
- **`writeSubtopicFacts(courseId, subtopicId, keyPoints)`** — called from `aggregateMaterials()`
  once a subtopic's sources are persisted. Writes Phase 2 step 2d's raw `extract_grounded_key_points`
  output (atomic, `source_id`-tagged points) as **one `add_memory` episode per key point** — not
  the paragraph-length step 2g synthesis, and not one batched episode for the whole subtopic.
  Per-point episodes are what makes each fact independently diffable/supersedable later, which is
  exactly what Phase 6's Knowledge Update Agent needs. This closes a real gap found while wiring
  this up: Phase 2's pipeline already computed these key points (feeding them into
  `synthesize_subtopic`) but never surfaced them past that one call — `SubtopicResult.keyPoints`
  is a new field threading them through to `CourseJson`, not a new extraction step.
- **`getTopicHistory(topic)`** — the read path: `search_nodes` + `search_memory_facts` + a
  group-scoped `get_episodes` call, combined into one `{nodes, facts, episodes}` result. Used for
  manual verification now (`npm run inspect-graph`); Phase 5's overlap detection and Phase 6's
  delta detection build on this same read path later.

**Every write degrades sensibly on failure** — logs loudly (`console.error`, not a silent catch)
and returns normally, never throwing. The graph is currently a side effect of course generation,
not something course generation depends on succeeding; `tests/memoryGraph.test.ts` proves this by
simulating a connection failure and asserting both write functions still resolve.

**Transport**: confirmed by reading `getzep/graphiti`'s actual `mcp_server` source (not assumed)
that `server.transport: "http"` in its config maps to `run_streamable_http_async()` — the modern
**Streamable HTTP** MCP transport (`StreamableHTTPClientTransport`, single `POST .../mcp/` endpoint
with an SSE upgrade for streaming responses) — while `"sse"` (the older two-endpoint transport) is
explicitly commented as deprecated in graphiti's own config schema. `src/memoryGraph/graphitiClient.ts`
uses `StreamableHTTPClientTransport`, a genuinely different transport class from Phase 1's
`StdioClientTransport` (Tavily is a local subprocess; Graphiti is an HTTP service).

**Tool result parsing** is defensive: Graphiti's `@mcp.tool()`-decorated functions return typed
dicts, which the MCP SDK may surface as an already-parsed `structuredContent` field or only as a
JSON-stringified text content block depending on server/SDK version. `GraphitiMCPClient.callTool()`
checks `structuredContent` first, then falls back to parsing `content[0].text` as JSON — this exact
branch has **not been exercised against a real server** in this environment (see "The Docker
verification gap" below), so treat it as a reasoned-but-unverified assumption, not a confirmed fact,
until it's run once against a live `docker compose up`.

**`add_memory` is asynchronous** — it queues the episode and returns a `"queued"` message
immediately; Graphiti's own LLM-based entity/fact extraction runs in the background afterward.
This means a `writeTopic`/`writeSubtopicFacts` call returning successfully does **not** mean the
data is queryable yet — `npm run inspect-graph` may show nothing for a few seconds after a `build`
run completes, which is expected background-processing latency, not a failure (the command's own
output says as much when it finds nothing).

**`group_id` is left at the server's shared default (`main`)** on every call from Teacher's client
— deliberately not namespaced per course. Phase 5's stated future need ("query existing mastery to
detect topic overlap") only works if different courses' topics and facts live in the same
queryable graph rather than siloed islands, so every course this app ever builds accumulates into
one graph. `courseId`/`subtopicId` are still recorded (in episode names and `source_description`)
for provenance, just not used to partition the graph.

**LLM provider inside Graphiti itself**: `mcp_server/config.yaml` sets both `llm.provider` and
`embedder.provider` to `"gemini"` (upstream's own default is `"openai"` for both — these are two
independently-configured blocks, so setting one without the other silently leaves embeddings on
a provider with no configured key). This reuses the same Google AI Studio key Teacher's own
Orchestrator already defaults to, avoiding a second, unrelated API key just for Graphiti's internal
bookkeeping — consistent with the "LLM provider swap" deviation documented elsewhere in this
README. The embedding model (`gemini-embedding-001`, 3072-dim) was verified live against Google's
current docs rather than assumed — `text-embedding-004`, the name that shows up in older
references, is now a legacy model.

## Phase 4: the Quiz/Assessment Engine and Practice/Experience Engine

Phases 1-3.5 got content generated and persisted. Phase 4 is the first phase that checks whether
the user actually learned anything — the **Quiz/Assessment Engine** (`src/quizEngine/`) tests
knowledge, the **Practice/Experience Engine** (`src/practiceEngine/`) builds applied experience,
and both write to the new `MasteryState` table that every later phase's "how well does the user
know X" question depends on (Phase 5's overlap detection, Phase 6's Continuous Learning Agent,
Phase 8's Mind Map mastery display). No Teaching Engine/voice (Phase 7.5), Continuous Learning or
Knowledge Update Agents (Phase 6), Goal Planner (Phase 5), or frontend — everything is exercised
through the CLI harness, same as every phase so far.

### concept_node_id granularity (documented simplification)

The PRD's eventual data model ties `MasteryState` to fine-grained concept nodes that the Mind Map
Agent (Phase 8) will define. Phase 8 doesn't exist yet, so **`concept_node_id` defaults to
`lesson_id` everywhere in Phase 4** — coarser than the PRD's eventual intent, but consistent (one
scheme used everywhere, not a placeholder in one place and something else elsewhere) and
upgradable later without a data migration: Phase 8 can introduce finer node ids and backfill.

This has one real consequence worth calling out: `QuizResult` is naturally lesson-scoped (`lesson_id`
column) and maps to `concept_node_id` directly, one-to-one. `PracticeAttempt` is module-scoped
(`module_id` column, per the PRD's own data model), which is coarser than a single lesson —
`recordPracticeAttempt()` handles this by **broadcasting** the attempt's `performanceScore` to
`MasteryState.experienceScore` for *every* lesson under that module (see `src/practiceEngine/index.ts`).
This means a module with three lessons gets three `MasteryState` rows all updated to the same
experience score after one practice attempt — a real approximation, not a precise per-lesson signal,
but it keeps every `MasteryState` row addressable by the same `concept_node_id` scheme a quiz would
use for the same lesson, so a later reader (Phase 5's overlap detection, Phase 8's Mind Map) can
join quiz and practice signal on one row per lesson without knowing about this module-vs-lesson
scoping difference. The real inspect run below shows this directly: a lesson that was both quizzed
and practiced (via its module) ends up with both `knowledge_score` and `experience_score`
populated on the *same* row.

### Deviation: topic_type is classified by the Practice Engine, not the Research Agent

The PRD's Practice Engine spec takes `topic_type` (conceptual vs. skill-based) as an input "set by
the Research Agent." Phase 2's Research Agent, as actually built, doesn't classify this — it was
never part of Phase 2's spec. Rather than reaching back into an already-verified earlier phase to
add a classification step it didn't originally need (and risking destabilizing it for a field only
Phase 4 uses), the Practice Engine classifies `topic_type` itself as its own first step: one more
`[LLM]` call (`classify_topic_type`, `src/orchestrator/templates/classifyTopicType.ts`), one more
registered template, routed through the Orchestrator like everything else. This keeps Phase 4
self-contained. See `preparePracticeSession()` in `src/practiceEngine/index.ts` for where this
runs (step 0, before format selection).

### The Quiz/Assessment Engine

`src/quizEngine/index.ts` exposes two functions matching the PRD's pipeline split — question
generation is separate from scoring/persistence so the CLI harness can present questions and
collect answers in between:

1. **`generateQuizQuestions(lessonId, tiers, options)`** — `[LLM]`, one call per requested tier
   (`generate_recall_questions` / `generate_application_questions` / `generate_transfer_questions`,
   one registered template each, per the PRD's "one new template per question tier"). Each call is
   grounded in the lesson's own persisted content — pulled straight from the `Lesson` row's `title`,
   `description`, and `layers` (the same five-layer content the Course Builder wrote in Phase 3) —
   never a generic, ungrounded prompt. Recall questions test direct facts/definitions from the
   lesson; application questions require using a lesson concept to solve a concrete problem;
   transfer questions describe a genuinely novel scenario not explicitly covered in the lesson text,
   grounded only in the lesson's *underlying* concept. Each question is either `multiple_choice`
   (options + a 0-based `correctOptionIndex`, scored in code) or `free_text` (a `rubric` describing
   what a correct answer must contain, written by the same call that wrote the question, so scoring
   later doesn't need to re-derive what "correct" means from scratch).
2. **`[code]` present questions, capture answers** — the CLI harness's job (`npm run harness -- quiz`),
   via `node:readline/promises`: multiple-choice prompts for a number (re-prompting on a
   non-numeric/out-of-range answer), free-text prompts for a line of text.
3. **`scoreAndRecordQuiz(lessonId, questions, answers, options)`** — `[code]` scores every
   `multiple_choice` answer directly (exact match against `correctOptionIndex`, 1 or 0, no LLM
   call); `[LLM]` scores every `free_text` answer **semantically**, via one `score_free_text_answer`
   call per free-text question — the model grades the learner's actual wording against the
   question's rubric, not a keyword match, and returns a continuous 0-1 score plus a short
   explanation. `tests/quizEngine.test.ts` proves this is genuinely semantic scoring by mocking two
   different answers to different scores and asserting they land where expected (a "known-good" and
   a "known-bad" answer), and the real run below (see "Definition of done") shows a real free-text
   answer scored 0 against a rubric it didn't actually match — proof the scorer checks meaning
   against the specific rubric, not just plausibility.
4. **`[code]`** writes one `QuizResult` row per tier tested (the tier's score is the average of that
   tier's question scores this session — not one row per question), then upserts
   `MasteryState.knowledgeScore` for `concept_node_id = lessonId`. The upsert (Drizzle's
   `onConflictDoUpdate`) targets **only** the `knowledge_score` and `last_updated` columns — an
   existing `experience_score` on that row is never touched by a quiz run (`tests/quizEngine.test.ts`
   proves this directly: pre-seed a row with an `experienceScore`, run a quiz, assert it's
   unchanged). The new `knowledgeScore` is the average of *every* question answered this session,
   across all tiers tested — replacing the previous value, since this is a current-state table, not
   an accumulating history (the Memory Graph is where the history lives — see below).
5. **`[code]`** mirrors the same update into the Memory Graph as a new dated fact
   (`memoryGraph.writeMasteryUpdate(conceptNodeId, "knowledge", score, detail)`) and surfaces weak
   concept nodes: any concept node whose new `knowledgeScore` falls below `QUIZ_WEAK_CONCEPT_THRESHOLD`
   (default `0.6`) is returned in `weakConceptNodes` and logged — per the PRD, this data just needs
   to exist in the right shape for now; nothing consumes it yet (Phase 8's Mind Map and Phase 4's
   own "candidates for targeted practice" wiring are later work).

**Score scale**: `knowledge_score` (and `experience_score`, below) are **0-1 continuous** for both
objective and free-text questions — the resolved default from the PRD's open questions, chosen for
consistency between the two very different scoring mechanisms (exact-match vs. semantic grading)
that both need to land on the same scale.

### The Practice/Experience Engine

`src/practiceEngine/index.ts` implements the PRD's pipeline as a sequence of small, independently
testable functions (mirroring the Quiz Engine's split between generation, presentation, and
recording) rather than one monolithic function, since the CLI harness needs to interleave real user
I/O (multi-turn dialogue, multi-line submissions) between several of the LLM steps:

1. **`preparePracticeSession(moduleId, options)`** runs steps 0-1: `[LLM]` `classify_topic_type`
   (the deviation above) grounded in the module's title/description and its lessons' summaries;
   `[LLM]` `select_practice_format` given that classification (project/simulation/debate — the
   template's system prompt documents project as usually best for skill_based, debate for
   conceptual, simulation as a flexible middle ground for either, but the model chooses freely
   rather than a hardcoded mapping, since format fit genuinely depends on the specific content, not
   just the topic_type label). It also computes `attemptNumber` (count of existing
   `PracticeAttempt` rows for this module, +1) and the resulting `difficulty` (see escalation cap,
   below), then generates that format's actual content — a realistic task/dataset/prompt
   (`generate_project_brief`), a scenario + AI persona/rules + opening line
   (`generate_simulation_scenario`), or a contested claim + assigned position + opponent's opening
   argument + opponent rules (`generate_debate_prompt`) — grounded in the module's lessons, and
   (once difficulty has escalated past `guided`) in the previous attempt's actual feedback text, so
   a harder variant targets a real recurring mistake rather than being generically harder.
2. **`runDialogueTurn(session, history, userInput, options)`** — the multi-turn step, shared by
   *both* `simulation` and `debate` (the PRD's step 2 wording — "respond in character, adapt to the
   user's input" — is generic, not format-specific, so one registered template, `dialogue_turn`,
   drives both rather than duplicating a near-identical prompt per format). The CLI harness
   (`npm run harness -- practice`) drives the actual multi-turn loop via `node:readline/promises`:
   read the learner's typed reply, call this once per turn with the running conversation history,
   print the AI's in-character reply, repeat until the learner types `/end` (or an 8-turn safety
   cap is hit). `project`-format sessions skip this step entirely — the harness instead collects a
   multi-line submission ended by a line containing only `/done`.
3. **`critiquePracticeAttempt(session, userOutput, options)`** — `[LLM]` `critique_practice_attempt`,
   given the practice brief (what the learner was asked to do) and `userOutput` (their actual
   submission or the full dialogue transcript). This is explicitly a PRD quality bar, not just a
   schema check: the critique must reference what the learner *specifically* did, not a templated
   response. `tests/practiceEngine.test.ts` asserts the learner's actual output text reaches the
   call and is referenced back in the mocked critique; the real run below shows a genuinely specific
   critique quoting the learner's exact (weak) response. The same call also returns a continuous
   `performanceScore` (0-1, same scale as `knowledge_score`) — this is what becomes
   `MasteryState.experienceScore`.
4. **`[code]`** the CLI harness generates a reflection prompt (`generateReflectionPromptText`,
   `[LLM]` `generate_reflection_prompt`, tailored to the actual critique just given — "what worked /
   what would you change," per the PRD) and captures the learner's typed reflection the same
   multi-line-until-`/done` way.
5. **`recordPracticeAttempt(session, critique, reflectionNotes, performanceScore, options)`** —
   `[code]` persists one `PracticeAttempt` row (`feedback` + `reflectionNotes` together, since both
   are known by this point) and updates `MasteryState.experienceScore` for every lesson under the
   module (see the concept_node_id broadcast, above) via an upsert that targets **only**
   `experience_score` and `last_updated` — a practice run never touches `knowledgeScore`
   (`tests/practiceEngine.test.ts` proves this the same way the Quiz Engine's symmetric test does).
   Mirrors each update into the Memory Graph the same way the Quiz Engine does, tagged `"experience"`.

**Escalation cap**: default **3 attempts** per module before the engine stops auto-generating
progressively harder variants, configurable via `PRACTICE_ESCALATION_CAP`. The pure mapping —
exported as `difficultyForAttemptNumber(attemptNumber, cap)` for direct unit testing — is: attempt
1 is `"guided"`, attempts 2 through `cap - 1` are `"harder"`, and attempt `cap` **and every attempt
after it** stay at `"novel_unguided"` rather than escalating indefinitely (with the default cap of
3: attempt 1 guided, attempt 2 harder, attempt 3+ novel_unguided). `recordPracticeAttempt()`'s
`willEscalateNextAttempt` return field tells the harness (and the report below) whether the next
run will actually be harder or has already hit the ceiling.

**Weak-concept threshold** (Quiz Engine): default `0.6`, per the PRD's resolved default —
explicitly not load-bearing yet, since nothing downstream consumes `weakConceptNodes` until a later
phase wires it up (same status as the PRD describes).

### Definition of done — Phase 4 (real run, both branches)

Docker still isn't installed in this environment (same gap as Phase 3.5 — see "The Docker
verification gap" below) and `TAVILY_API_KEY` still isn't configured (same gap Phase 2/3's
"real-run blocker" section describes), so a real `research`/`build` run wasn't possible here either.
Unlike Phase 2/3, though, the Quiz and Practice Engines don't need web search at all — they operate
entirely on already-persisted lesson/module content — so a real (non-mocked) run against real
`GEMINI_API_KEY` calls **was** done, grounded in a course built via `build --dry-run` (mock lesson
text) plus one hand-seeded module/lesson with genuine SQL content (to get a fair real classification
on both `topic_type` branches — the dry-run course's three modules all share near-identical mock
text and would likely all classify the same way):

- **All three quiz tiers, real and grounded**: against the mock lesson, `generateQuizQuestions`
  produced real recall questions asking about the lesson's own (mock) layer text, a real
  application question about diagnosing a failed deployment using the lesson's Mechanics/Application
  layers, and — genuinely novel, per the transfer-tier spec — real transfer questions about
  fiber-optic signal degradation and drone-delivery load balancing, neither mentioned anywhere in
  the lesson, but grounded in the same "frequency/capacity-threshold" and "distributed load"
  concepts the lesson's mock content gestures at.
- **Real objective + free-text scoring, both correct**: answering the first multiple-choice question
  correctly and a deliberately wrong one incorrectly scored exactly `1` and `0` in code, no LLM
  call. A free-text answer about real Newton's-Laws inertia — a *plausible-sounding but actually
  off-topic* answer relative to this lesson's (mock) rubric — was correctly scored `0` by the
  semantic grader, and a genuinely weak "I don't remember" answer also scored `0`: `tierScores:
  { recall: 0.5, application: 0, transfer: 0 }`, `overallScore: 0.167`.
- **MasteryState + weak concept node, real and persisted**: the low overall score correctly
  triggered `weakConceptNodes: ["lsn_mock-lesson-mock-subtopic-one_30b30d"]`, and the row is visible
  via the extended `npm run inspect`:
  ```
  QuizResult qr_... — tier: recall, score: 0.50
  QuizResult qr_... — tier: application, score: 0.00
  QuizResult qr_... — tier: transfer, score: 0.00
  MasteryState (concept_node_id: lsn_mock-lesson-mock-subtopic-one_30b30d) — knowledge_score: 0.1667, experience_score: 0.1
  ```
- **Correct format selection, both topic_type branches, real classifications**: the mock module
  (generic, no concrete task described) was classified `"conceptual"` with the justification
  *"the provided mock module description and lesson content lack actionable procedural tasks...
  describing topic material that leans toward understanding ideas rather than executing a
  practical skill"* and routed to `debate`, generating a real contested claim about peer-review
  learning. The hand-seeded module (real SQL JOIN/WHERE/GROUP BY/HAVING content) was classified
  `"skill_based"` with justification *"mastery of SQL query writing requires the practical
  execution of writing syntax... rather than just understanding relational database theory
  conceptually"* and routed to `project`, generating a genuinely well-grounded task (join
  `customers`/`orders`, filter by `is_active`/`status`/date range, `GROUP BY` + `HAVING
  total_spent_2023 > 500`) that directly exercises the concepts named in that lesson's own Mechanics
  layer — real evidence that format selection tracks topic_type correctly, and that content
  quality scales with how real the underlying lesson content is (the mock-content debate is
  noticeably more generic than the real-content SQL project, as expected).
- **Specific, non-templated critique**: attempt 1's response ("I think it's basically fine, no
  major issues that I can see") produced a critique that directly quotes that response and explains
  specifically why it conceded the debate instead of arguing the assigned position — not a generic
  "good effort" response.
- **A harder attempt 2 that visibly incorporates attempt 1's mistake**: running
  `preparePracticeSession` again for the same module produced `attemptNumber: 2`, `difficulty:
  "harder"`, `priorMistakes` populated verbatim with attempt 1's critique text, and a **new**
  generated claim (about reviewer vs. receiver learning gains, a harder framing of the same
  underlying idea) whose `opponentRules` explicitly instruct the AI opponent to *"push back firmly
  if the user gives passive, agreeable, or non-committal responses (e.g., 'I agree' or 'looks
  fine')"* — a direct, visible response to exactly the mistake attempt 1 made.
  `recordPracticeAttempt`'s `willEscalateNextAttempt: true` after attempt 1 confirmed this was
  expected before attempt 2 ran.
- **knowledge_score and experience_score updated independently, on the same row, confirmed in
  SQLite**: the lesson that was both quizzed and practiced (via its module) shows
  `knowledge_score: 0.1667` (from the quiz, untouched by the practice run) and
  `experience_score: 0.1` (from the practice run's `performanceScore`, untouched by the quiz) on
  one `MasteryState` row — exactly the independent-update guarantee both engines' tests assert.
- **Memory Graph mirroring**: both `writeMasteryUpdate` calls (one `"knowledge"`, one
  `"experience"`) were attempted against the real client and degraded gracefully (logged, not
  thrown) since no Graphiti service is running in this environment — same documented gap as Phase
  3.5, and covered independently by `tests/memoryGraph.test.ts`'s `writeMasteryUpdate` suite (call
  shape, `"knowledge"`-vs-`"experience"` distinction, graceful degradation).
- All 108 tests pass (`npm test`), `npm run typecheck` is clean.

## Phase 5: the Goal/Career Path Planner

Phases 1-4 operate on ONE topic at a time: research it, build it into a course, persist it, quiz
and practice against it. Phase 5 (`src/pathPlanner/`) is the layer in front of that pipeline that
handles broad goals ("become a full-stack quant," "become financially independent") — decomposing
them into a multi-course roadmap, checking what's already mastered before generating anything new
(overlap detection is the actual point of this module, and it's meaningless without real
`MasteryState` data to check against — which is why the roadmap sequences this phase after Phase 4
and Phase 3.5, not earlier), and generating courses **on demand** rather than all at once. No
syllabus-of-syllabi UI (Phase 7), no career-level knowledge graph rendering (Phase 8), no
Continuous Learning/Knowledge Update Agents (Phase 6 — order between Phase 5 and 6 doesn't
functionally matter, since neither depends on the other; the roadmap just lists this one first).
Exercised via the CLI harness, same as every phase so far.

### The Path data model (a documented gap, not a literal PRD table)

The PRD's Section 7 core data model (Course/Module/Lesson/Source/QuizResult/PracticeAttempt/
MasteryState/Book/UpdateEvent) has no Path entity, even though section 5.12a clearly requires
persisting one. `paths` / `path_domains` / `path_topics` (`src/db/schema.ts`) are an **original
design filling that gap** — not a literal spec table — following the shape the prompt sketched:

- **`Path`**: `id`, `goal_description`, `created_at`, `status` (`active`\|`completed`).
- **`PathDomain`**: `id`, `path_id`, `name`, `order` — a skill domain within the goal (e.g. "Math,"
  "Programming," "Finance" for "become a full-stack quant"). Domain `order` is purely
  presentational grouping/display order — the actual cross-domain scheduling constraint lives
  entirely on `PathTopic.order`/`parallel_group`, not here.
- **`PathTopic`**: `id`, `path_id`, `domain_id`, `topic_name`, `description`, `order`,
  `parallel_group`, `course_id` (nullable), `status`
  (`pending`\|`linked_existing`\|`delta_needed`\|`in_progress`\|`mastered`).

Two design choices worth calling out explicitly, since they're mine, not the PRD's:

- **`order` is a topological TIER across the WHOLE path's cross-domain graph, not a per-topic
  unique sequence number.** Tier 0 = no prerequisites within the path; tier N = depends on at
  least one tier-(N-1) topic and nothing later. `parallel_group` is a separate column but is
  currently derived 1:1 from the tier (every topic at tier N shares one `parallel_group`, literally
  `"tier_N"`) — it exists as its own field because "which topics form one freely-orderable batch"
  is the more directly useful thing for a UI/CLI (or a future, finer-grained scheduler) to group
  by, even though today it's just a formatted version of `order`. See
  `src/pathPlanner/ordering.ts`.
- **Topic selection (Deliverable 4) is TIER-gated, not raw-edge-gated.** The schema doesn't persist
  the raw dependency edges past ordering time (`determine_cross_domain_dependencies`'s output is
  consumed once, by `computeCrossDomainOrder()`, and then discarded — only the derived
  `order`/`parallel_group` are persisted). So `isTopicGeneratable()` in `src/pathPlanner/index.ts`
  gates on "every topic at a strictly lower tier is done," not "every topic this one specifically
  depends on is done" — a topic can't jump ahead of ANY earlier tier, even a topic in that tier it
  doesn't technically depend on. This is a deliberate, documented simplification (a full raw-edge
  gate would need a `path_topic_dependencies` join table this design doesn't have) that still
  satisfies the PRD's actual requirement ("don't let them jump ahead of a sequential prerequisite
  that isn't done, but parallel-track topics are freely orderable") — topics in the SAME tier
  really are mutually parallel by construction (the tiering algorithm guarantees no dependency
  edge within a tier), which is the part that has to be exactly right.
- **`status: "mastered"` is reserved, not assigned by anything in Phase 5.** Overlap detection only
  ever writes `pending`/`linked_existing`/`delta_needed`; on-demand generation transitions
  `pending`/`delta_needed` → `in_progress` → `linked_existing` (reusing `linked_existing` to mean
  "this topic now has a ready `course_id`," whether that came from an overlap match OR fresh
  generation — the harness's own in-memory session tracking, not a DB field, is what distinguishes
  "just generated this run" for display purposes). `mastered` is left for Phase 6 (the Continuous
  Learning Agent), which will have real accumulated quiz evidence to promote a topic with once it
  exists — Phase 5 alone never has grounds to claim a freshly-generated or freshly-linked course
  has actually been learned yet.
- **concept_node_id granularity (Phase 4) has one consequence here**: `PathTopic` is module/course-
  scoped, but `MasteryState` is keyed at `lesson_id` granularity (see Phase 4's own documented
  simplification). Overlap detection's aggregate score for a candidate course is the AVERAGE
  `knowledge_score` across that course's scored lessons (see "Overlap detection" below) — a
  reasonable aggregate given the granularity mismatch, not a precise per-topic signal.

### Deviation: `goalContext` is a small additive Research Agent option, not a rewrite

The PRD's "goal-scoped depth" requirement means the Research Agent needs to accept optional goal
context that biases emphasis. Rather than rewriting Phase 2, `runResearchPipeline(topic, options)`
(`src/research/pipeline.ts`) gained one new optional field on its existing options object:
`goalContext?: string`. When present, it's threaded into exactly two prompts —
`decompose_topic`'s and `synthesize_subtopic`'s — as extra framing text ("bias emphasis, not
rigor"); every other call in the pipeline (`generate_search_queries`, `extract_grounded_key_points`,
`restructure_layers`, `depth_audit_score`, `classify_volatility`) is untouched. When absent (the
default — every standalone call from Phases 1-4, and every call in Phase 5's own test suite that
doesn't pass it), behavior is byte-for-byte unchanged; `tests/research.pipeline.test.ts`'s
"goalContext (Phase 5 additive option)" suite proves both the threading (present in exactly those
two calls' context, absent everywhere else, and surfaced on the returned `CourseJson.goalContext`)
and the no-op case (completely absent when the option isn't passed). This stayed a small, additive
change exactly as scoped — it never needed to touch the Research Agent's core pipeline logic.

`CourseJson.goalContext` flows through `buildCourse()` into `courses.goal_context` (Phase 5's one
schema addition to an existing table), which is what lets overlap detection later tell "generic
fundamentals" (`goal_context: null`) apart from "mastered under a DIFFERENT goal's angle" (a
different non-null value) for the SAME topic.

### Deliverable 1: classification

`classifyInput(input, options)` (`src/pathPlanner/index.ts`) is a thin wrapper around one `[LLM]`
call (`classify_topic_or_goal`) — it never decides anything by itself. The CLI harness
(`npm run harness -- goal "<input>"`) always prints the model's classification and reasoning, then
asks the user to confirm or override before proceeding ("This looks like a big GOAL — build a full
path, or just one course on the core idea?"); an override is respected exactly like the model's own
call — a single-topic classification (or override) routes straight into the existing
`build`/Phase 2→3→3.5 pipeline unchanged (literally: `runGoalCommand` calls `runBuildCommand([input])`),
a goal classification (or override) continues into decomposition below. Nothing about this decision
is ever applied silently.

### Deliverable 2: decomposition + cross-domain dependency mapping

`decomposeAndPersistPath(goalDescription, options)` runs both of Deliverable 2's `[LLM]` steps —
`decompose_goal_into_path` (goal → domains → topics, tempId-referenced like `sequence_modules`'
module tempIds) and `determine_cross_domain_dependencies` (raw prerequisite EDGES across the WHOLE
topic set, not just within one domain — explicitly prompted to look for cross-domain edges
specifically, since that's "the actually hard part" per the PRD) — then turns the raw edges into
actual scheduling tiers via `computeCrossDomainOrder()` (`src/pathPlanner/ordering.ts`), a pure,
LLM-free, directly-unit-tested function (`tests/pathPlannerOrdering.test.ts`) generalizing
`courseBuilder/sequence.ts`'s `topoSortModules()` from one flat order to topological LEVELS: Kahn's
algorithm, but every node at the same remaining-in-degree-zero round lands in the same tier instead
of being linearized arbitrarily. Same philosophy as every other multi-step pipeline in this
codebase: the model reports the raw graph, code computes the aggregate (never trust the model with
a self-consistent order it could get out of sync with its own edges) — a genuine cycle throws
`PathPlannerError` rather than silently guessing an order, and self-referencing/dangling edges are
dropped rather than trusted verbatim.

`decompose_goal_into_path` returning an implausibly large topic count only logs a warning
(`PATH_TOPIC_COUNT_WARNING_THRESHOLD = 40`) and proceeds — a sanity check, not a hard cap, per the
PRD ("this is a personal tool, not a system that needs to protect itself from its own user").

`[code]` persists `Path`/`PathDomain`/`PathTopic` rows in one transaction — every `PathTopic` starts
with `course_id: null`, `status: "pending"`. Overlap detection (below) runs as its own separate
pass afterward, not folded into this step.

### Deliverable 3: overlap detection

`runOverlapDetectionForPath(pathId, options)` resolves and PERSISTS every `PathTopic`'s status
before any course generation happens, then returns the annotated roadmap — the CLI harness prints
it explicitly (domain → tier → status, one line per topic), mirroring the PRD's UX requirement even
though there's no UI yet; none of these decisions are ever applied silently.

The actual decision (`resolveOverlapForTopic()` / `decideOverlapBranch()`,
`src/pathPlanner/overlap.ts`) combines Phase 4's `MasteryState` (SQLite — structurally joinable,
authoritative for "does a course with a matching topic exist, and what's its aggregate mastery")
with Phase 3.5's `getTopicHistory()` (the Memory Graph — a text search that can recover a candidate
course id via a DIFFERENTLY-worded course title, using a genuinely real mechanism:
`writeTopic()`'s episode text literally embeds `course_id: <id>`, so
`extractCourseIdsFromHistory()` regex-extracts it back out — not guessed, read straight off what
`memoryGraph/index.ts` actually writes). A course's "aggregate mastery" is the average
`knowledge_score` across its lessons that have one at all (see the concept_node_id note above); with
no scored lessons at all, it's treated as `null` (not yet mastered), not zero.

The decision logic itself is a **pure function**, `decideOverlapBranch()` — no DB, no LLM, no I/O —
so every branch is directly unit-testable by constructing candidate objects
(`tests/pathPlannerOverlap.test.ts`). Precedence, matching the PRD's bullet order:

1. **No candidate course found at all** → `pending`.
2. **A candidate exists but its aggregate `knowledge_score` is below the high-score threshold** (or
   has no quiz history at all) → `pending` ("not yet mastered").
3. **ANGLE MISMATCH checked before recency** — a candidate that IS high-scoring but was built under
   a DIFFERENT goal's `goal_context` (a non-null value that doesn't match this path's goal
   description) → `delta_needed`, `course_id` left `null` (a delta hasn't been generated yet — see
   Deliverable 4). A candidate with `goal_context: null` (built standalone — generic fundamentals)
   is never treated as a mismatch; a candidate whose `goal_context` matches (case/whitespace-
   insensitive) isn't either.
4. **Angle-compatible and high-scoring, within its volatility tier's recheck window** →
   `linked_existing`, `course_id` set to the matched course directly (no extra LLM call).
5. **Angle-compatible, high-scoring, but PAST the recheck window** → one lightweight
   `quick_refresh_check` `[LLM]` call (explicitly NOT a full re-research — topic, volatility tier,
   days since last verified, and the course's current lesson titles; defaults toward
   `stillAccurate: true` unless there's a concrete reason to doubt it, since this check exists
   specifically to avoid unnecessary re-research) → `linked_existing` if it passes, `pending`
   ("regenerate") if real gaps surface.

Branches 4 and 5-pass both resolve to the same `status: "linked_existing"`, but
`resolveOverlapForTopic()`'s `branch` field (`fresh_high_score` vs. `stale_recheck_passed`) keeps
them distinguishable — `tests/pathPlannerOverlap.test.ts` and the real run below demonstrate both
as genuinely different code paths, not just two instances of the same outcome.

**Resolved thresholds** (the PRD's open questions, both configurable via env vars — see above):

- **"High score"**: `knowledge_score >= 0.75` (`PATH_HIGH_SCORE_THRESHOLD`) — reusing Phase 4's
  weak-concept threshold (0.6) inversely, per the PRD's own suggested default.
- **"Past the volatility recheck window"**: a simple date check (`PATH_RECHECK_WINDOW_DAYS_*`) —
  30/90/180/90 days for fast/medium/slow/mixed — rather than blocking on Phase 6's Knowledge Update
  Agent recheck-scheduling logic, which doesn't exist yet. Phase 6 will formalize this later; this
  is deliberately just a date comparison in the meantime, per the PRD's own resolved default.

### Deliverable 4: on-demand generation

No course content is generated upfront for the whole roadmap — every `PathTopic` persists with
`course_id: null` until it's individually picked. `isTopicGeneratable(topic, allTopics)`
(`src/pathPlanner/index.ts`, pure) is the tier-gating guard described above; the CLI harness only
ever offers generatable topics as choices, and `generateTopicCourse()` re-checks the same guard
itself (defense in depth) before doing anything, throwing `PathPlannerError` rather than silently
generating out of order.

Generating a topic runs the EXISTING Phase 2 → 3 → 3.5 pipeline (`runResearchPipeline` →
`buildCourse` → `aggregateMaterials`, completely unmodified code) with `goalContext` set to this
path/domain's framing, then updates that `PathTopic`'s `course_id` and `status` (→ `in_progress`
while running, → `linked_existing` on success).

**Delta course scope** (the PRD's open question, resolved): for a `delta_needed` topic, "narrow"
is achieved by PROMPT FRAMING, not a structurally separate code path — the topic string handed to
`runResearchPipeline` is rewritten to explicitly ask for just the emphasis gap ("additional depth
specifically for the goal X, beyond what's already covered generically... focus tightly on the gap,
not a full re-teach"), `goalContext` names it a "TARGETED DELTA," and `maxAuditRetries` is set to
`0` (one pass is enough for a narrow gap). This reuses the Research Agent's existing pipeline
entirely unchanged in code — which also keeps this well inside the "don't rewrite the Research
Agent" guardrail from the kickoff prompt — rather than building a separate narrow single-subtopic
mode. `generateTopicCourse()`'s `wasDelta` return field and `tests/pathPlanner.test.ts` both
confirm the delta topic string is genuinely reframed (not just the bare topic name).

### Definition of done — Phase 5

**Classification — real, both boundary cases, genuinely confirmed:**

```
Input: "Photosynthesis"
-> { classification: 'topic',
     reasoning: 'Photosynthesis is a specific biological process that can be thoroughly taught
     as a single, focused subject or course.' }

Input: "become a full-stack quant"
-> { classification: 'goal',
     reasoning: 'Becoming a full-stack quant requires mastering several distinct, independent
     fields including quantitative finance, advanced mathematics, statistical modeling, and
     software engineering. Because this spans multiple distinct domains rather than a single
     cohesive subject, it is a broad goal rather than a single topic.' }
```

Both real calls (`classifyInput()`, real `GEMINI_API_KEY`, no mocking) landed on the obviously
correct side of the topic/goal boundary with genuinely on-target reasoning — real evidence for the
DoD's "classification correctly identifies at least one clear single-topic input and one clear goal
input."

**Blocked, same day, by the exact wall Phase 2/3 already hit** (see "The real-run blocker" above):
the very next real call, `decompose_goal_into_path` for `"become a full-stack quant"`, hit Gemini's
`RESOURCE_EXHAUSTED` free-tier daily cap — confirmed genuinely exhausted (not transient) by
immediately retrying a second, minimal, unrelated `classify_topic_or_goal` call afterward, which
failed identically. This blocks a real end-to-end demonstration of decomposition, cross-domain
ordering, overlap detection, and on-demand generation together in one live run — including the
CLI's interactive classification-override step, since even the one `classify_topic_or_goal` call
that step needs was no longer available. **Unlike Phase 2/3's still-open items, this isn't left
purely as a documented gap** — every one of those pieces is instead verified by real, deterministic
tests exercising the actual production code (not reimplemented test-only logic), which is what
Phase 3's own Definition-of-done treated as sufficient evidence for its own equally-blocked items:

- **Cross-domain ordering, a real cross-domain dependency, genuinely demonstrated**:
  `tests/pathPlanner.test.ts`'s `decomposeAndPersistPath` integration test feeds a mocked
  `determine_cross_domain_dependencies` response where a Programming-domain topic ("NumPy for
  Linear Algebra") depends on a Math-domain topic ("Linear Algebra") — a genuine cross-domain edge,
  not a same-domain one — and asserts the PERSISTED `order` reflects it (the Math topic at tier 0,
  the Programming topic strictly later, on different `parallel_group`s), proving
  `computeCrossDomainOrder()`'s real tiering algorithm runs correctly against real persistence, not
  just in isolation. `tests/pathPlannerOrdering.test.ts` additionally proves the algorithm itself
  handles longer chains, multiple dependencies via max-tier, cycles (`PathPlannerError`), and
  dangling/self edges (ignored) — all pure, no LLM, no mocking needed at all.
- **All four overlap-detection scenarios, hit individually, including the two that both resolve to
  `linked_existing` via different paths**: `tests/pathPlannerOverlap.test.ts`'s
  `resolveOverlapForTopic` suite constructs a fresh-and-high-scoring candidate (→
  `linked_existing`/`fresh_high_score`, no extra LLM call), a stale-but-high-scoring candidate with
  a mocked `quick_refresh_check` returning `stillAccurate: true` (→ `linked_existing`/
  `stale_recheck_passed`) AND a second copy returning `false` (→ `pending`/`stale_recheck_failed`)
  — proving both real outcomes of that branch, not just one — an angle-mismatched candidate (→
  `delta_needed`/`angle_mismatch`, `course_id` deliberately left unlinked) and no candidate at all
  (→ `pending`/`no_match`). `decideOverlapBranch()`'s own pure unit tests independently re-confirm
  every threshold edge (exact high-score cutoff, exact recheck-window cutoff per volatility tier,
  case/whitespace-insensitive angle matching, a `null lastUpdated` treated as infinitely stale).
- **On-demand generation, the state transition AND the ordering guard, both verified against real
  persistence**: `tests/pathPlanner.test.ts`'s `generateTopicCourse` suite (mocked
  `runResearchPipelineFn`/`buildCourseFn`/`aggregateMaterialsFn`, the same DI seam
  `build --dry-run` uses) confirms a pending topic's `course_id`/`status` update to
  `linked_existing` with the UNMODIFIED topic string reaching the pipeline, a `delta_needed`
  topic's topic string genuinely reframed (asserted to differ from the bare topic name and mention
  "emphasis" — not just a flag saying so) with `wasDelta: true`, and — critically — a topic at a
  later tier whose earlier tier isn't finished yet is REFUSED (`PathPlannerError`, zero pipeline
  calls made, zero DB mutation) rather than silently generated out of order. `isTopicGeneratable`'s
  own pure unit tests separately confirm same-`parallel_group` topics never block each other even
  mid-tier, and an already-`linked_existing`/`mastered`/`in_progress` topic is never itself
  re-offered as generatable.
- **`goalContext` threading, confirmed present exactly where it should be and absent everywhere
  else**: `tests/research.pipeline.test.ts`'s "goalContext (Phase 5 additive option)" suite
  confirms `decompose_topic` and `synthesize_subtopic` receive it when passed (and it lands on the
  returned `CourseJson`), that `generate_search_queries` (an unrelated call in the same pipeline
  run) never sees it, and that omitting the option leaves every call and the returned `CourseJson`
  completely unaffected — the "small, additive, no rewrite" guardrail, checked directly rather than
  just asserted in prose.
- All 161 tests pass (`npm test`; 108 from Phases 1-4 + 44 new for Phase 5 + 9 in
  `research.pipeline.test.ts` including the 2 new `goalContext` tests), `npm run typecheck` is
  clean.

**What would still be worth doing once the quota resets or billing is enabled**: a real
`npm run harness -- goal "<a genuinely broad goal>"` run all the way through, including a real
`quick_refresh_check` call and real on-demand generation of at least one topic (needs
`TAVILY_API_KEY` too, for that last step) — the exact same "Options to actually close these out"
list in "The real-run blocker" above applies unchanged.

### Documented gaps

- **No Trafilatura fallback for low-confidence extractions.** `fetchAndClean` returns a
  confidence score; a low-confidence page is simply excluded from that subtopic's source set
  (logged, not retried through a second extractor). This was explicitly optional for Phase 2, and
  Phase 3 explicitly named the signal to watch for: "if real runs in this phase show a meaningful
  fraction of lessons falling below the valid-source threshold specifically because of extraction
  failures." **That signal was not observed this phase** — every `build` run so far was `--dry-run`
  (see "Definition of done" below for why: the real Gemini free-tier quota was exhausted before a
  real end-to-end `build` could complete), so there's no real-run extraction data yet to judge
  Trafilatura against. The decision stays deferred, not because it was ruled out, but because
  there's no organic evidence yet either way — revisit once a real `build` run exists.
- **No additional search providers yet** (arXiv, YouTube, Consensus, Firecrawl) — both the
  initial and contention-focused searches reuse Phase 1's Tavily adapter. This was a deliberate
  scope boundary (see the kickoff prompt): adding source diversity and proving the multi-pass
  synthesis loop are separable problems, and conflating them would have made it harder to tell
  whether a weak result was a synthesis problem or a sourcing problem.

## Phase 6: the Continuous Learning Agent and the Knowledge Update Agent

Phases 1-5 generate, persist, test, and roadmap learning content. Phase 6 adds the two agents that
make the system feel alive after a course is done, rather than static: the **Continuous Learning
Agent** (`src/continuousLearning/`, what should you learn next, and what books are worth reading)
and the **Knowledge Update Agent** (`src/knowledgeUpdate/`, does anything you already learned need
revisiting because the world changed). Both are framed, per the PRD, as encouraging continued
engagement rather than manipulating it — no artificial urgency, no dark patterns; `generate_next_
topic_suggestions`'s system prompt says this explicitly. No Dashboard, no push notifications, no
Motivation/Engagement Layer UI (Phase 9) — both agents surface their output through the CLI harness
(`npm run harness -- suggest`/`whats-new`), matching the PRD's own stated v1 delivery model
("pull-based... push notifications are a later upgrade").

### Data model additions

The last two of PRD Section 7's deferred tables, plus one original addition (`src/db/schema.ts`):

- **`Book`**: `id`, `title`, `author`, `related_topic_id`, `status` (`suggested`\|`reading`\|`read`).
  `related_topic_id` references **`courses.id`**, not a standalone "Topic" entity — the PRD's data
  model has no persisted Topic table (Phase 5 hit the identical gap for `Path`; see "The Path data
  model" above), and a completed course is the real anchor a recommendation is generated FROM,
  whether that course was built standalone or via a Path. Two fields go beyond the PRD's literal 5
  columns, same spirit as Phase 5's `goalContext`: `category` (`core`\|`optional_deep_dive`\|
  `primary_source`, the ranking the PRD's own step asks for) and `openLibraryWorkId`/`gutenbergUrl`
  — the verified-availability EVIDENCE that makes "not a hallucinated title" a checkable guarantee,
  not just a hope. `status` transitions beyond `suggested` are defined but not driven by any code
  path yet in v1 — same "reserved, not assigned yet" status as `PathTopic.status`'s `mastered` value
  (Phase 5).
- **`UpdateEvent`**: `id`, `topic_id` (also → `courses.id`, same reasoning), `detected_at`,
  `severity` (`minor`\|`moderate`\|`major` — `"none"` is a valid model output during classification
  but is never persisted as an event; nothing actually changed, so there's nothing to log),
  `delta_summary`, `superseded_fact_ref` (the old Graphiti fact edge's uuid, recovered via a
  best-effort text match against `getTopicHistory()`'s real fact strings — null when no confident
  match is found, never guessed).
- **`LessonUpdate`** (an original addition, not a literal PRD table — the PRD's storage decision for
  major deltas needed *some* table, and the PRD's own Section 7 doesn't name one): `id`, `lesson_id`,
  `update_event_id`, `title`, `what_changed`, `updated_guidance`, `created_at`. See "'Update lesson'
  storage" below.
- **`courses.completed_at`** (nullable timestamp) and **`courses.last_checked`** (nullable
  timestamp) — see "Completion trigger" and "Recheck interval" below.

### Deviation: course completion is `completed_at`, not a repurposed `status` value

`courses.status` (`"building"`\|`"complete"`) already means Phase 3's content-pipeline signal — has
the Material Aggregator finished linking sources? — a completely different concept from "did the
LEARNER finish this course." The PRD's kickoff prompt for this phase says "flip the Course.status
field to completed" without accounting for `status` already carrying that unrelated meaning;
reusing it would conflate the two and break every existing `status: "complete"` check across
Phases 3-5. `completedAt` is a separate, additive nullable column instead — null until the
completion trigger fires, non-null (a real timestamp, more informative than a bare boolean) after.

### Completion trigger

**Default, per the PRD's resolved answer**: a course is complete once every lesson under it has at
least one `QuizResult` across all three tiers (`recall`/`application`/`transfer`). This is checked
in `quizEngine.checkAndMarkCourseCompletion(lessonId, db)`, called at the end of
`scoreAndRecordQuiz()` (`src/quizEngine/index.ts`) right after the `QuizResult` insert — the "small
addition to Phase 4's quiz-write step" the phase asked for. It walks every lesson under the quizzed
lesson's course, checks each has `QuizResult` rows covering all of `ALL_QUIZ_TIERS`, and — only if
every lesson qualifies AND `completedAt` was still null — sets it to `now` and returns the course
id; every other case (partial coverage, already complete, unknown lesson) returns `null` without
touching the row. `scoreAndRecordQuiz()`'s result surfaces this as `courseCompleted` (the course id,
present ONLY on the call that actually flipped it) — this is the real trigger condition, not a
stub; `npm run harness -- suggest <course_id>` is still a manual invocation in v1 since there's no
Motivation Layer/notification system yet to auto-fire it (see the scope boundary above).
`tests/quizEngine.test.ts`'s "checkAndMarkCourseCompletion" suite covers partial coverage, full
coverage, the already-complete no-op case, and `scoreAndRecordQuiz`'s `courseCompleted` field
directly.

### New MCP integrations for book recommendations

Following the exact same swappable-adapter pattern as Phase 1's `TavilyMCPSearchProvider`
(`src/mcp/webSearch.ts`) — a thin interface calling code depends on, MCP protocol details never
leaking past the adapter class:

- **`src/mcp/openLibrary.ts`** — `OpenLibraryMCPProvider`, over `@cyanheads/openlibrary-mcp-server`
  (`npx -y @cyanheads/openlibrary-mcp-server@latest`, stdio, no API key — Open Library is a free,
  public catalog). Uses `openlibrary_search_books`. Its input (`title`/`author`/`limit`) and output
  shape (`works[]` with `work_id`/`author_names`/`edition_count`/`first_publish_year` — the MCP
  server's own NORMALIZED shape, notably different from the raw Open Library search API's
  `docs[]`/`key`/`author_name` shape) were read directly from the real tool source
  (`github.com/cyanheads/openlibrary-mcp-server`'s `openlibrary-search-books.tool.ts`), not guessed
  — and then confirmed against a real, live call (see "Definition of done" below): searching "Thinking,
  Fast and Slow" by Daniel Kahneman genuinely returned `work_id: "OL15992072W"`,
  `edition_count: 35`, `first_publish_year: 2011`.
- **`src/mcp/gutenberg.ts`** — `GutenbergMCPProvider`, over `@cyanheads/gutenberg-mcp-server` (same
  launch pattern, no API key — Project Gutenberg is public domain). Uses `gutenberg_search_books`
  (`query`/`topic`/`languages`/`sort`/`ids`/`page` input, `books[].has_plain_text` output — again
  read from real source, `gutenberg-search-books.tool.ts`), confirming legitimate free/open
  full-text availability where it exists, per the PRD's copyright constraint (link/summarize, never
  download full copyrighted text — `gutenberg_get_text`, the one tool that would fetch actual book
  content, is deliberately never called anywhere in this codebase). Confirmed live: "Pride and
  Prejudice" by Jane Austen genuinely resolves to Gutenberg id 1342
  (`https://www.gutenberg.org/ebooks/1342`); "Thinking, Fast and Slow" (a real, still-copyrighted
  book) correctly resolves to no match.

Both were chosen over their alternatives (`8enSmith/mcp-open-library` for Open Library) because
they share one author/convention (`cyanheads`) and the Open Library one also resolves cover images
(`openlibrary_get_cover_url`, not used yet — see "Documented gaps" below) if a future phase wants
them.

### Deliverable 1: the Continuous Learning Agent (`src/continuousLearning/`)

1. **`getCourseCompletionContext(courseId, options)`** — `[code]`: loads the course row, its
   lessons, and `getTopicHistory(topic)` (Phase 3.5's Memory Graph read path — "full learning
   history"). Doubles as the trigger guard: throws `ContinuousLearningError` when
   `course.completedAt` is null — "course marked complete, not mid-course" is enforced here, not
   just documented, so this agent can never run against a partial course even called directly.
2. **`generateBookRecommendations(courseId, context, options)`** — `[LLM]` `generate_book_
   candidates` identifies 3-6 candidate titles (foundational + current), each ranked `core`\|
   `optional_deep_dive`\|`primary_source` in the SAME call (the categories are naturally coupled to
   candidate identification, same pattern as `decompose_topic` returning prerequisites+subtopics
   together) → `[MCP]` each candidate is verified via Open Library (a loose title match against real
   search results — no match, no persistence) and checked against Gutenberg for legitimate free
   full-text → `[code]` only VERIFIED candidates are persisted to `Book` (`status: "suggested"`); an
   unverifiable title is returned in a separate `rejected` list (for harness display) and NEVER
   reaches the table. This is what makes "not hallucinated titles" a checked guarantee rather than
   a hope — `tests/continuousLearning.test.ts` proves a model-invented, unverifiable title is
   dropped while a verified one persists with its real `openLibraryWorkId`.
3. **`generateNextTopicSuggestions(courseId, context, options)`** — `[code]`
   `getCrossCourseConnections(topic)` (new Memory Graph read, see below) plus the diversity check
   (next item) feed into one `[LLM]` `generate_next_topic_suggestions` call producing BOTH a
   `deepen` suggestion (natural next step, same domain) and a `branch` suggestion (adjacent/novel
   domain, preferring a real cross-course connection when one exists) — never persisted (see
   "Statelessness decision" below), print-only.
4. **Diversity check**: `getRecentCourseDomains(options)` pulls the last `N` (default 5, `DIVERSITY_
   WINDOW_N`) *completed* courses' domains — a path-linked course reads its real `PathDomain`
   (Phase 5); a standalone course gets a lightweight `infer_course_domain` `[LLM]` tag, computed
   fresh every call, never persisted (same statelessness philosophy as the suggestions themselves).
   `isDomainClusterNarrow(domains, threshold, minSample)` is a PURE function (no DB, no LLM) — narrow
   when at least `minSample` (default 3, avoids false-positiving on a fresh install with too little
   data) domains are available and the single most common domain's share is `>= threshold` (default
   0.6, `DIVERSITY_CLUSTER_THRESHOLD`). When narrow, `generate_next_topic_suggestions`'s prompt is
   told the recent domains explicitly and instructed to treat a genuinely different domain for
   `branch` as a HARD constraint, not a soft preference. `tests/continuousLearning.test.ts` proves
   both the pure threshold boundaries and that a real narrow cluster (3 extra completed courses,
   same inferred domain) flips `diversityBiasNeeded` through to the actual LLM call.
5. **`getCrossCourseConnections(topic)`** (new `src/memoryGraph/index.ts` read method) — best-effort,
   deliberately grounded in `writeTopic()`'s own known fact-text format
   (`"${topic}" requires prior knowledge of "${prerequisite}".`) via regex extraction, the identical
   "not guessed, read straight off what this file actually writes" approach
   `extractCourseIdsFromHistory()` (Phase 5, `src/pathPlanner/overlap.ts`) already uses for course
   ids. Graphiti's MCP server exposes no generic neighbor-traversal tool (only text/semantic search
   via `search_nodes`/`search_memory_facts` — confirmed from the real tool list, see below), so this
   can't be more precise than "topics whose `REQUIRES_PREREQUISITE` fact text mentions this topic by
   name," in either direction. Never throws — degrades to `{connectedTopics: [], error}`, same
   pattern as `getTopicHistory`.
6. **Statelessness decision**: `Suggestion` records are deliberately NOT persisted — topic
   suggestions are recomputed fresh every `suggest` run. There's no Dashboard yet to make stale
   suggestions a real problem, and inventing a `Suggestion` table/lifecycle now would be designing
   ahead of an actual consumer — a documented v1 simplification, not an oversight. Book candidates
   ARE persisted (`status: "suggested"`), per the phase's own explicit instruction.

### Deliverable 2: the Knowledge Update Agent (`src/knowledgeUpdate/`)

A **standalone script** (`npm run knowledge-update`, `src/knowledgeUpdate/cli.ts`) — run manually or
via an external scheduler, deliberately NOT a persistent daemon inside the app, per the PRD's "no
heavy job-queue infra" guidance. See "Wiring to cron" below.

1. **`getDueTopics(options)`** — `[code]`: a course is due when `last_checked` is null (never
   checked — always due) or older than `getRecheckIntervalDays(volatilityTier)` (see "Recheck
   interval, formalized" below).
2. Per due topic, **`checkTopicForUpdates(topic, options)`**:
   - **a. `[LLM]` `generate_recheck_queries`** — a LIGHTER version of Phase 2's
     `generate_search_queries`: 1-3 targeted "what's changed" queries (given a summary of what's
     already known), not the full multi-pass (initial + contention) set a fresh course build uses.
   - **b. `[MCP]`** `webSearch()` + `fetchAndClean()` — Phase 2's own adapters
     (`src/mcp/webSearch.ts`, `src/extraction/fetchAndClean.ts`), reused DIRECTLY, not wrapped in a
     full `researchPass()` — this is a targeted recheck, not a re-research.
   - **c. `[LLM]` `compare_findings_to_facts`** — the severity classifier, the core judgment call of
     this whole agent. Compares fresh findings against the topic's `getTopicHistory()` facts and
     classifies each REAL delta (`"none"` deltas — a finding that just restates an existing fact —
     are excluded from the output entirely). The system prompt embeds the PRD's rubric with
     concrete anchors, verbatim: **minor** = wording/detail/citation changes that don't affect the
     substance; **moderate** = a meaningfully updated fact, figure, statistic, or recommended
     method; **major** = a core claim reversed, deprecated, or superseded entirely. Every delta also
     names `relatedLessonId` — validated (`validateExtra`,
     `createCompareFindingsToFactsValidator`) against the due course's real lesson id set, the same
     pattern `createDecomposeGoalIntoPathValidator` (Phase 5) uses for tempId references. This
     exists because Memory Graph facts don't retain which lesson/subtopic they came from —
     `search_memory_facts` returns edge records, and the subtopic id `writeSubtopicFacts` embeds
     lives only in the originating EPISODE's `source_description`, which that tool doesn't return —
     so rather than solving that correlation problem, the model is handed the course's real lesson
     list and picks the best match directly, grounded and checkable.
   - **d. `[code]`** writes one `UpdateEvent` per real delta. **Only moderate/major deltas trigger
     real graph supersession** (`memoryGraph.supersedeFact`, below) — a documented choice: a minor
     wording-only difference isn't worth invalidating a stable fact edge over. `major` additionally
     runs `[LLM]` `generate_update_lesson` and persists a `LessonUpdate` row (see below).
3. **`[code]`** display routing (no separate write — this is what reading `UpdateEvent` back by
   severity means): **minor** → silent log only (console output, nothing else); **moderate** →
   included in the `whats-new` digest; **major** → digest-flagged prominently, WITH the generated
   `LessonUpdate` content attached.
4. **`[code]`** `courses.lastChecked = now`, written per topic checked regardless of outcome — this
   alone is what makes a second immediate run a genuine no-op (nothing will be due again until the
   interval elapses), confirmed for real below, not just in tests.

### Recheck interval, formalized

Phase 5 approximated this as a stopgap (30/90/180/90 days for fast/medium/slow/mixed) while waiting
for this phase. **Formalized now**: `getRecheckIntervalDays(tier)`
(`src/shared/recheckInterval.ts`) — a single exported function, defaults **fast=14, medium=60,
slow=180** per the PRD's resolved answer (`mixed` wasn't specified by the PRD; defaults to medium's
value as a reasonable middle ground, independently configurable like every other tier). Lives in
`src/shared/` (alongside `src/shared/ids.ts`), not inside either phase's own module — Phase 5's
`src/pathPlanner/overlap.ts` now imports and calls it instead of its own copy (its
`DEFAULT_RECHECK_WINDOW_DAYS` export is kept, now just re-exporting the shared module's values, so
existing import paths/tests didn't need to change beyond updating the expected numbers), which is
what actually satisfies "go back and update Phase 5's overlap-detection code to use this" — verified
by `tests/pathPlannerOverlap.test.ts`'s updated threshold assertion. Env vars renamed
`PATH_RECHECK_WINDOW_DAYS_*` → `RECHECK_INTERVAL_DAYS_*` (documented rename below) since the concept
is no longer Phase-5-specific.

### Graphiti fact supersession — confirmed from real source, not guessed

The one piece of this phase that has to get Graphiti's actual temporal semantics right (`memoryGraph.
supersedeFact(topic, oldClaim, newClaim)`, `src/memoryGraph/index.ts`), confirmed by reading
`getzep/graphiti`'s real source directly (`graphiti_core/graphiti.py`'s `add_triplet` method →
`resolve_extracted_edge` → `resolve_edge_contradictions` in
`graphiti_core/utils/maintenance/edge_operations.py`), the same diligence the existing Memory Graph
client already applied to the MCP transport: calling `add_triplet` resolves the source/target nodes,
then searches (a) existing edges between that SAME node pair and (b) semantically similar existing
facts more broadly; when it finds a contradiction, it marks the OLD edge's `invalid_at`/`expired_at`
while persisting the new edge alongside it — the old edge is **never deleted**, matching "supersede,
don't delete-and-reappend" exactly. `delete_entity_edge` (the MCP server's only other edge-mutation
tool — a hard delete by uuid) is deliberately never used for this.

`supersedeFact` reuses the SAME synthetic target node name (`"${topic} — current facts"`) on EVERY
call for a given topic, so search (a) — the precise, node-pair-scoped candidate search — reliably
finds every prior `HAS_FACT` edge for that topic as an invalidation candidate, rather than relying
solely on the broader semantic-similarity search (b). `oldClaim` isn't threaded into the
`add_triplet` call as a lookup key (Graphiti finds the old edge by content, not by an id the caller
supplies) — it's folded into the new fact's text instead, giving Graphiti's semantic search a
clearer contradiction signal and leaving a self-documenting audit trail in the graph itself.
`tests/memoryGraph.test.ts`'s `supersedeFact` suite confirms the exact call shape (tool name
`add_triplet`, the stable target node, both claims present, `delete_entity_edge` never called).

### "Update lesson" storage

Per the PRD's resolved decision: a major delta's generated content is stored as a small, ADDITIVE
`LessonUpdate` record (`lesson_id` + `update_event_id` + `title`/`what_changed`/`updated_guidance`)
linked to the ORIGINAL lesson — never a rewrite of the original's five-layer content. The original
lesson stays intact as a historical record; the `LessonUpdate` is what's actually new. `generate_
update_lesson`'s system prompt explicitly frames this as a short, targeted delta ("NOT a full
re-teach"), assuming the reader already took the original lesson.

### Diversity window (N)

Default 5 (last 5 completed courses), per the PRD's resolved default — configurable via
`DIVERSITY_WINDOW_N`.

### Deliverable 3: extending the test harness

```bash
# Phase 6: the Continuous Learning Agent, real APIs by default — runs on a course already marked
# complete (courses.completedAt set, via real quiz activity, not a manual flag). Prints verified
# book recommendations (an unverifiable title is dropped, never printed as a real suggestion) plus
# a deepen and a branch next-topic suggestion.
npm run harness -- suggest <course_id>
npm run harness -- suggest --dry-run <course_id>   # mocked LLM + both new MCP providers

# Phase 6: the "what's new" digest — pulls and prints whatever `npm run knowledge-update` has
# already written. Major items flagged prominently (with their generated update-lesson content),
# moderate items listed, minor items counted only unless --include-minor is passed.
npm run harness -- whats-new
npm run harness -- whats-new --include-minor

# Phase 6: the Knowledge Update Agent's standalone scheduled-job script — idempotent (see above).
npm run knowledge-update
npm run knowledge-update -- --dry-run   # mocked LLM/search/extraction, isolated data/teacher.dry-run.db
```

**Wiring `npm run knowledge-update` to a real cron entry** (actual OS-level scheduling is outside
this repo's concern, per the PRD — this is a documented example, not something automated here):

```cron
# Run the Knowledge Update Agent daily at 3am
0 3 * * * cd /path/to/teacher && npm run knowledge-update >> logs/knowledge-update.log 2>&1
```

### Definition of done — Phase 6

**Real, live-confirmed MCP integrations** (no API key, no Docker needed for either): the smoke test
quoted under "New MCP integrations" above ran against the REAL `@cyanheads/openlibrary-mcp-server`
and `@cyanheads/gutenberg-mcp-server` packages via `npx` — a real search for "Thinking, Fast and
Slow" by Daniel Kahneman returned genuine Open Library data (`OL15992072W`, 35 editions, first
published 2011), a real Gutenberg check for "Pride and Prejudice" correctly resolved to Gutenberg id
1342, and a real Gutenberg check for the still-copyrighted "Thinking, Fast and Slow" correctly
returned no match — both the "verified" and "not available" branches are real, not assumed.

**Real completion trigger, real Gemini calls, partially blocked by the exact wall Phase 2/3/5 already
hit**: a `build --dry-run` course ("Special Relativity," 3 lessons) was quizzed for real —
`generateQuizQuestions`/`scoreAndRecordQuiz`, real `GEMINI_API_KEY`, no mocking — across all three
tiers for 2 of its 3 lessons, including genuinely discriminating real semantic free-text scoring
(a deliberately generic "thoughtful answer" scored 0.5, not a blind 1.0 — proof the real scorer is
actually judging content, consistent with Phase 4's own documented evidence). The third lesson's
quiz hit Gemini's free-tier **daily** cap (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`,
`quotaValue: 20`) mid-session — confirmed genuinely exhausted (not a transient per-minute limit,
which was hit and successfully waited out earlier in the same run) by the error's own explicit
quota-metric name. This blocks a real end-to-end demonstration of the THIRD lesson's completion
and a real (non-`--dry-run`) `suggest` run in the same session `GEMINI_API_KEY` was exhausted under.
**Every piece is still verified independently**, matching Phase 5's own precedent for this exact
situation:

- **Completion trigger, both branches, against real persistence**: `tests/quizEngine.test.ts`'s
  `checkAndMarkCourseCompletion` suite proves partial tier coverage never flips `completedAt`, full
  coverage across every lesson does, an already-complete course isn't re-stamped, and
  `scoreAndRecordQuiz`'s `courseCompleted` field is present ONLY on the call that actually
  triggers it — plus the REAL evidence above that the underlying mechanism (real quiz generation +
  real semantic scoring + real persisted `QuizResult`/`MasteryState` rows) genuinely works against
  live Gemini responses for 2 of 3 lessons.
- **`suggest`, demonstrated deterministically**: `npm run harness -- suggest --dry-run` (against
  the same course, `completedAt` set) shows both real branches live — a verified candidate persisted
  with its `openLibraryWorkId`/`gutenbergUrl`, and an unverifiable candidate dropped with a stated
  reason — plus both a `deepen` and a `branch` suggestion printed. `tests/continuousLearning.test.ts`
  independently proves the same book-verification filtering and the diversity-bias-kicking-in case
  (3 extra completed courses clustering in one inferred domain → `diversityBiasApplied: true`,
  threaded into the real LLM call context) against real persistence, not mocks reimplementing the
  logic.
- **`knowledge-update`, a real run demonstrating all three severities and real idempotency**:
  `npm run knowledge-update -- --dry-run` (real code, mocked LLM/search — the same convention `build
  --dry-run` established) genuinely classified deltas at all three severities in one run (2 major, 2
  moderate, 2 minor across 2 due topics) and printed the routing correctly — minor silent, moderate
  listed, major flagged with generated `LessonUpdate` content (confirmed via a real subsequent
  `npm run harness -- whats-new` / `--include-minor` run reading it back). A real, unmocked SECOND
  `knowledge-update -- --dry-run` run immediately after found `0` due topics — genuine idempotency,
  not asserted only in `tests/knowledgeUpdate.test.ts` (which independently covers the same
  interval-boundary and no-op logic with an injected clock).
- **Severity classification's three branches + `supersedeFact`'s call shape**: `tests/
  knowledgeUpdate.test.ts` mocks `compare_findings_to_facts` directly to hit minor (UpdateEvent only,
  `supersedeFact` NOT called), moderate (UpdateEvent + `supersedeFact` called, no update lesson), and
  major (UpdateEvent + `supersedeFact` + a real persisted `LessonUpdate` linked to the correct
  lesson) as three genuinely separate assertions, plus a `"none"`-severity delta that persists
  nothing at all. `tests/memoryGraph.test.ts`'s `supersedeFact` suite confirms the exact `add_triplet`
  call shape (topic-scoped stable target node, both claims present, `delete_entity_edge` never
  called) independently of the graph actually being reachable.
- **Fact supersession's real Graphiti semantics**: NOT demonstrated against a live graph — this
  environment has no Docker installed (see "The Docker verification gap" above; unchanged since
  Phase 3.5/5), so `inspect-graph` can't confirm a real `invalid_at` timestamp on a real old edge.
  What IS verified: the call shape is correct per Graphiti's actual source (see above, cited not
  guessed) and `supersedeFact` is exercised for real, end-to-end, in the `knowledge-update --dry-run`
  run above (degrading to a logged connection error exactly as designed — never silently skipped,
  never crashing the run). This is the same category of gap as Phase 3.5/5's Memory Graph writes —
  unverified-live but not unverified-by-design.
- Recheck interval formalization: `tests/recheckInterval.test.ts` covers `getRecheckIntervalDays`'s
  defaults/overrides directly; `tests/pathPlannerOverlap.test.ts`'s updated assertion confirms Phase
  5 now reads the same shared values (14/60/180/60), not a drifted copy.
- All Phase 1-5 tests still pass; 196 tests total (`npm test`) — 165 from Phases 1-5 + 31 new for
  Phase 6 (`tests/continuousLearning.test.ts`, `tests/knowledgeUpdate.test.ts`,
  `tests/recheckInterval.test.ts`, plus additions to `tests/quizEngine.test.ts` and
  `tests/memoryGraph.test.ts`).
- `npm run typecheck` clean.

**What would still be worth doing once the Gemini quota resets or billing is enabled**: the third
lesson's real quiz completion and a fully real (non-`--dry-run`) `suggest` run against it — the exact
same "Options to actually close these out" list in "The real-run blocker" below applies unchanged,
plus a real Docker/Graphiti setup to close "The Docker verification gap" for `supersedeFact`
specifically.

### Documented gaps

- **Book cover images** (`openlibrary_get_cover_url`) — the Open Library MCP server supports
  resolving cover images, per the PRD's own suggestion, but nothing in this phase's CLI-only output
  needs one yet. Left for whichever future phase actually renders a book recommendation visually.
- **`superseded_fact_ref` is best-effort, not guaranteed.** It's recovered by text-matching the
  LLM's `existingFactSummary` paraphrase against the real fact strings `getTopicHistory()` returned
  — when no confident match is found (a genuinely new observation not tied to one specific prior
  fact, or a paraphrase too loose to match), it's `null`. This doesn't affect `supersedeFact`'s own
  correctness (which finds the edge to invalidate by content, via Graphiti's own contradiction
  search, not via this id) — it only affects the DB record's own traceability.

## Phase 7: the frontend (Next.js against the real Phase 1-6 backend)

Phases 1-6 built a fully working backend where every module in `src/` is a plain exported
function, deliberately kept framework-agnostic (per Phase 1's own stated goal) so a UI could be
layered on later without rework. Phase 7 is that UI: a Next.js App Router frontend calling the
SAME functions the CLI harness (`src/harness/cli.ts`) already calls, against the real SQLite DB —
not a separately-mocked API contract. `src/` did not move and was not rewritten; `app/`
(Next.js) and `components/` sit alongside it. Six screens: Dashboard, topic/goal entry, Path view,
Course view, Lesson/Teaching, Quiz, plus Practice (the module's practice entry point). Explicitly
NOT this phase: Mind Map rendering (Phase 8), voice/TTS playback (Phase 7.5), Motivation Layer
engagement mechanics (Phase 9), offline/PWA (Phase 10) — each gets a visible, clearly-labeled
placeholder (`components/PlaceholderPanel.tsx`) rather than a fake or a silently-omitted stub.

### Running the dev server

```bash
npm run dev      # next dev --webpack, http://localhost:3000
npm run build     # next build --webpack
npm start         # next start (serves the build output)
```

### Bundler: webpack, not Turbopack (a real, confirmed compatibility gap — not a preference)

Every `dev`/`build` script is pinned to `--webpack` and `next.config.ts` carries a `webpack()`
function setting `resolve.extensionAlias: { ".js": [".ts", ".tsx", ".js"] }`. This is a deliberate,
confirmed-necessary deviation from Next 16's new default (Turbopack), not a style preference:
`src/`'s existing code — verified across 6 phases via `tsx`/`vitest`/`tsc` — uses NodeNext module
resolution, which requires every relative import to carry an explicit `.js` extension even though
the real file is `.ts` (the standard Node ESM + TypeScript convention; see
`tsconfig.backend.json`). The instant any Server Component or Route Handler imports from `src/`,
the bundler has to trace and resolve that entire import graph — and Turbopack has no equivalent
to webpack's `resolve.extensionAlias` yet. This is confirmed as a real, currently-open, unresolved
Turbopack gap, not a misconfiguration on this project's part —
[vercel/next.js#82945](https://github.com/vercel/next.js/issues/82945), "Turbopack: support
importing .ts/.tsx via .js extension (parity with webpack resolve.extensionAlias)". Every page
that reached into `src/` failed to compile under Turbopack with `Module not found` for imports
like `./client.js` (a real file named `client.ts`) until this was diagnosed and fixed.

Rewriting `src/`'s own internal imports to drop their `.js` extensions was rejected as the fix: it
would mean changing a verified, tested-across-6-phases module resolution convention purely to
satisfy the frontend bundler — exactly the kind of "rework a verified phase for a UI need" this
phase's own kickoff prompt warns against. webpack's `resolve.extensionAlias` is a first-party,
stable, zero-new-dependency Next.js/webpack mechanism that solves this with zero changes to
`src/` — confirmed by testing all three real options against this exact failure (Turbopack: fails;
plain webpack with no config: also fails, since Next's built-in webpack setup doesn't enable
`extensionAlias` automatically either; webpack + the explicit config above: works) rather than
guessing. Revisit this once Turbopack ships the equivalent feature.

### `tsconfig.json` split, not a shared/mutated config

The pre-existing root `tsconfig.json` (NodeNext resolution, `include: ["src", "tests"]`) was
renamed to **`tsconfig.backend.json`**, byte-identical otherwise — the lowest-risk option for a
verified backend. A **new** root `tsconfig.json` is Next.js's own standard shape
(`moduleResolution: "bundler"`, `jsx: "react-jsx"` — Next.js's `next dev` mandatorily corrected
this from an initial `"preserve"` on first run — `lib: ["dom", "dom.iterable", "esnext"]`,
`include` scoped to `app/`/`components/`/`.next/types`, `exclude: ["src", "tests"]`). Next.js's
own tooling expects to own root `tsconfig.json` by convention (and auto-edits it — see the `jsx`
correction above and `include` gaining `.next/dev/types/**/*.ts` — both accepted as-is, not
reverted). `npm run typecheck` runs both configs in sequence.

`next-env.d.ts` and `.next/` are gitignored (Next.js's own default convention — both are
regenerated automatically by `next dev`/`next build`). `CLAUDE.md`/`AGENTS.md` at the repo root are
ALSO auto-generated by `next dev` itself (`node_modules/next/dist/server/lib/generate-agent-files.js`)
and are committed, not gitignored — Next 16 regenerates and re-adds them if removed, per its own
embedded instruction, and they carry a real, current warning worth keeping: read
`node_modules/next/dist/docs/` before assuming pre-16 Next.js API shapes.

### Server Components vs. API routes — the actual split, and why

**Server Components fetch data directly, no self-HTTP round-trip.** Dashboard
(`app/page.tsx`), Course view, Path view, and the Lesson view's static content call backend
functions/queries directly in-process — e.g. the Path view reuses `loadPathRoadmap()` and
`isTopicGeneratable()` from `src/pathPlanner/index.ts` (Phase 5) completely unchanged. This is
why the prompt's literal `GET /api/courses/:id` / `GET /api/paths/:id` / `GET /api/lessons/:id` /
`GET /api/digest` routes were **not built as separate HTTP endpoints** — a Server Component calling
the real function directly is a thinner wrapper than a route that would just re-wrap the same
call for an in-process caller. A generate action (Path view's per-topic "Generate", Dashboard's
would-be refresh) re-reads via `router.refresh()` (re-running the Server Component), not
client-side refetch plumbing.

**API routes exist specifically for interactive, stateful, multi-step, or long-running flows**:
the classify-confirm step, the three SSE generation streams, the Lesson screen's Q&A, the Quiz
screen's generate/score round trip, and the Practice screen's four-step session. Every route
handler is a thin wrapper — parse the request, call the existing exported function, shape the
result as JSON, return it — confirmed directly (`app/api/**/route.ts` files run 15-44 lines each;
no business logic lives in `app/api`).

### Progress feedback: SSE (GET/EventSource), which three routes, and why

Course generation takes minutes (multi-pass research + depth-audit retries) — the PRD is explicit
that the UI must communicate real progress, not imply an instant result. Every long-running module
already accepts a `ProgressListener` callback (`buildCourse`, `runResearchPipeline`,
`decomposeAndPersistPath`, `runOverlapDetectionForPath`, `generateTopicCourse`). Three routes
stream that callback live as Server-Sent Events, GET-based (EventSource only supports GET, so
trigger+stream are one request rather than a separate job-id layer — nothing here needs to be
resumed across a page load):

- `GET /api/courses/build-stream?topic=...` → `runResearchPipeline` → `buildCourse` →
  `aggregateMaterials` (the exact chain `build` already runs).
- `GET /api/paths/decompose-stream?goalDescription=...` → `decomposeAndPersistPath` →
  `runOverlapDetectionForPath`.
- `GET /api/paths/:id/topics/:topicId/generate-stream` → `generateTopicCourse`.

`app/api/_sse.ts`'s `createSseResponse()` is the shared framing (not a route itself — the
leading underscore excludes it from Next's router). Event names are `progress`/`done`/`failed` —
deliberately NOT `error`, since a browser `EventSource` dispatches its OWN native `error` event
(a plain `Event`, no `.data`) on a real connection failure, and reusing that name for a
server-sent custom event would make the two genuinely ambiguous to a client listener.
`components/ProgressStream.tsx`'s `useProgressStream()` hook is the client side, rendering a live
scrolling log (`ProgressLog`) rather than a bare spinner. `POST /api/courses/:id/suggestions`
(`runContinuousLearningAgent`) and `POST /api/classify` stay plain request/response — a handful
of LLM+MCP calls, not the multi-minute case this requirement is actually about.

### Practice session state — in-memory, a documented v1 gap

`app/api/practice/_sessionStore.ts` is a module-level `Map<sessionId, PracticeSessionState>` —
API-layer glue, deliberately NOT added to `src/` (keeping "`src/` is the only place agent
pipelines live" intact). Same "don't design ahead of an actual need" judgment call Phase 6 made
for Suggestion records: no new DB table for in-flight sessions. **A page refresh mid-session loses
this state** — persisted `PracticeAttempt`/`MasteryState` rows are only written once
`/api/practice/:id/reflect` actually completes — an accepted v1 gap, not a bug, exactly as the
kickoff prompt pre-approved. Restarting the dev/prod server process also clears every in-flight
session.

The prompt's suggested single `finish` endpoint was split into **two** routes matching the CLI's
real two-step flow (`critiquePracticeAttempt` produces critique+score+a reflection prompt; the
learner then reflects; THEN `recordPracticeAttempt` runs): `POST /api/practice/:id/submit` and
`POST /api/practice/:id/reflect`. All four practice routes share one dynamic segment name (`[id]`)
rather than `[moduleId]`/`[sessionId]` — Next.js requires every dynamic segment at the same path
position to share one slug name across the whole route tree (a real build error hit and fixed:
"You cannot use different slug names for the same dynamic path"); `start` uses it as a module id,
`turn`/`submit`/`reflect` as a session id.

### New backend surface (small, scoped, per the kickoff prompt's own allowance)

- **`src/teachingEngine/answerLessonQuestion.ts`** + a registered `answer_lesson_question`
  template — the one genuinely missing piece needed to make the Lesson screen's text-question Q&A
  real rather than a static content viewer. Grounding is CHECKABLE, not just prompted: the
  lesson's real `sourceRefs` (joined against the `sources` table, same truncation reasoning as
  `research/pipeline.ts`'s `toSourceExcerpt`) are given as context, the model must return which
  `sourceIds` it drew on, and `research/grounding.ts`'s existing `createCitationValidator` —
  reused completely unchanged, not reimplemented — enforces every returned id is real.
  `tests/answerLessonQuestion.test.ts` covers the grounding wiring and the "outside this lesson's
  scope" honest-answer path with a mocked LLM call, the same pattern every other `[LLM]` step in
  this codebase uses.
- **`src/db/queries.ts`** — read-only, cross-cutting queries the screens need that don't belong to
  one existing module: `getDashboardCourses`/`getCompletedCourses`/`getActivePathsWithProgress`
  (Dashboard), `getCourseDetail` (Course view — modules/lessons in persisted order, each lesson's
  `MasteryState` and linked sources), `getLessonWithSources` (Lesson/Quiz views), `getPathMeta`
  (Path view's goal/status, alongside Phase 5's own `loadPathRoadmap`). No new DB tables — every
  shape needed already exists in `src/db/schema.ts`. `tests/dbQueries.test.ts` covers each
  function against a real migrated in-memory DB.

### Two real bugs found and fixed during frontend integration (not "agent" changes)

Both are `src/db/client.ts` infrastructure-correctness fixes, not changes to any agent's pipeline
— the kind of shared-infra bug that was always latent but that nothing before Phase 7 ever
exercised (every prior caller — the CLI harness, every test — called `getDb()` sequentially, one
`await` at a time; a Server Component doing `Promise.all([several independent reads])` is a
completely normal, encouraged Next.js pattern that genuinely needed this to work):

- **`getDb()` had a concurrency race.** Two concurrent calls for the same fresh path both saw the
  module-level cache as `null` (caching only happened AFTER the first call's `migrate()`
  resolved), so both opened their own `DatabaseSync` handle onto the same file and raced to run
  migrations against it — the second one threw `table "courses" already exists`. This is exactly
  what broke the Dashboard's first real load (`Promise.all([getDashboardCourses(),
  getCompletedCourses(), getActivePathsWithProgress(), getWhatsNewDigest()])`). Fixed by memoizing
  the in-flight open+migrate promise so concurrent callers await the SAME run.
  `tests/dbClient.test.ts` reproduces this against a real temp file (confirmed to genuinely fail
  on the pre-fix code, not just pass trivially) — a real `node:sqlite` `":memory:"` path wouldn't
  reproduce it, since each `":memory:"` connection is its own isolated database with nothing to
  race over.
- **`resetDbCache()` never closed the underlying connection.** Harmless for `":memory:"` (every
  pre-Phase-7 test's choice), but leaves a real file handle locked on Windows until GC eventually
  runs — surfaced by the same new test's temp-directory cleanup. Fixed to close the handle
  (swallowing an already-closed error) before dropping the reference.

Both fixes are covered by the new regression test and the full pre-existing suite still passes
unchanged (208/208 total).

### Definition of done — Phase 7

**Real, live-confirmed rendering for all six screens plus Practice**, verified by actually running
`npm run dev` and requesting every route (not just `npm run typecheck`/`npm test` passing) — every
dynamic page correctly 404s (`notFound()`) for an unknown id, and every page renders successfully
against real seeded data:

- **Dashboard**: verified against `data/teacher.dry-run.db` (temporarily pointed at via
  `TEACHER_DB_PATH` for this verification pass only — reverted afterward; the real
  `data/teacher.db` has no real courses yet, since a real `build` still needs `TAVILY_API_KEY`,
  which remains unset in this environment). Correctly separated an in-progress course from a
  completed one, showed the REAL `getWhatsNewDigest()` output the `knowledge-update --dry-run` run
  below actually wrote (major items with their generated update-lesson content, moderate items
  listed, "2 minor item(s) not shown"), and rendered the Completed-courses section with its
  on-demand suggestions button.
- **Course view**: verified against the same dry-run course, showing REAL mastery state from
  actual quiz activity — see below — not fixture data (2 lessons "In progress" at their real 0.5
  scores, 1 "Not started," matching exactly what the real quiz session below produced).
- **Lesson view**: verified — layers render (intuition default, deeper layers behind the
  disclosure), the Voice-playback placeholder is visibly present and labeled "Phase 7.5", real
  linked sources render in the citations panel (`Sources (4)`, matching the real persisted
  `sourceRefs` count from the Material Aggregator), and the Q&A form renders correctly. The Q&A
  call itself (`answer_lesson_question`) is verified via `tests/answerLessonQuestion.test.ts`
  (mocked LLM) — a live UI round-trip was blocked by the same Gemini quota exhaustion described
  below, not attempted as a substitute for a real call.
- **Quiz screen**: initial "Start quiz" state verified rendering correctly; the full
  generate→answer→score flow is proven end-to-end at the FUNCTION level (see below — 2 of 3
  lessons' real quiz sessions, real Gemini calls, real persisted `QuizResult`/`MasteryState`) but
  NOT re-driven through the actual browser UI in this pass — Gemini's free-tier daily cap
  (confirmed exhausted, see below) was hit before a UI click-through could be attempted; this is
  the one Definition-of-Done item ("through real UI interaction, not API calls made by hand") not
  fully closed out this phase, honestly reported rather than glossed over.
- **Practice screen**: same status as Quiz — initial "Start practice" state verified rendering;
  the full session flow's backend chain (`preparePracticeSession`/`runDialogueTurn`/
  `critiquePracticeAttempt`/`recordPracticeAttempt`) is Phase 4's own verified, tested code,
  reused unchanged behind the four new routes, but a live end-to-end UI click-through is blocked
  by the same quota wall.
- **Path view**: verified rendering AND `isTopicGeneratable()`'s real tier-gating logic working
  correctly in the UI — but against a **hand-constructed SQL fixture** (2 domains, 3 topics across
  `pending`/`linked_existing`/`delta_needed`, one tier-1 topic deliberately dependent on a
  tier-0 one), not an agent-generated one. Real/dry-run goal decomposition both need a real
  `classify_topic_or_goal`/`decompose_goal_into_path` Gemini call (`build --dry-run` has a
  dedicated mock path; `goal` does not), and Gemini's quota was already exhausted by the time this
  screen was reached. The fixture was removed immediately after verification (this project's "no
  synthetic/fabricated data" rule applies to every check, not just persisted seed data) — this
  screen's DATA was never real or even dry-run-agent-generated, only its rendering and the reused
  `isTopicGeneratable` logic were verified; documented plainly rather than left ambiguous.

**Real backend evidence, hitting the same wall Phases 2/3/5/6 already documented**: a real quiz
session ran against the dry-run course's 3 lessons — `generateQuizQuestions`/`scoreAndRecordQuiz`,
real `GEMINI_API_KEY`, real semantic free-text scoring — across all three tiers for 2 of 3 lessons
before Gemini's free-tier **daily** cap (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`,
`quotaValue: 20`) was hit, confirmed genuinely exhausted by the explicit quota-metric name in the
error, not assumed. This is the SAME course/quota-exhaustion state Phase 6's own README documents
in detail; Phase 7 didn't get a fresh quota window.

**The classify-confirm-override flow**: implemented (`app/new/page.tsx`) exactly per the hard UX
requirement carried over from Phase 5 — the model's classification and reasoning are always shown
and require an explicit user click (`Build one course` / `Build a full path`) before anything is
generated, with the override path (picking the opposite of the model's own call) equally
supported, not a hidden escape hatch. **Not live-demonstrated through the browser this phase** —
the classify step itself needs a real `classify_topic_or_goal` Gemini call, blocked by the same
exhausted quota. This mirrors Phase 5's own Definition-of-Done precedent exactly (that phase's
classify-override step was verified via two real, successful calls made BEFORE its own quota wall
hit, then everything downstream via tests) — here, quota was already gone by the time this phase
started, so even that first-call evidence isn't available fresh from this phase. The code path
itself is not in question (`classifyInput()` is Phase 5's own real, tested function; this phase
only adds a thin route wrapper and a form around it) — flagged honestly as unverified-live-this-
phase rather than claimed.

**`knowledge-update --dry-run` and its digest, run again for real** (deterministic, no quota
needed): confirms the Dashboard's "what's new" section reads back real `UpdateEvent`/
`LessonUpdate` rows a real script run wrote, not fixture data — the exact major/moderate/minor
content shown in the Dashboard screenshot-equivalent above is what that run actually produced.

- All Phase 1-6 tests still pass; 208 tests total (`npm test`) — 196 from Phases 1-6 + 12 new for
  Phase 7 (`tests/answerLessonQuestion.test.ts`, `tests/dbQueries.test.ts`,
  `tests/dbClient.test.ts`).
- `npm run typecheck` clean across both `tsconfig.backend.json` (`src/`, `tests/`) and
  `tsconfig.json` (`app/`, `components/`).
- Every `app/api/**/route.ts` file is a thin wrapper — confirmed directly (15-44 lines each, no
  duplicated business logic against `src/`).

**What would still be worth doing once the Gemini quota resets or billing is enabled**: a real,
full UI click-through of the classify-confirm-override flow, a quiz session, and a practice
session, plus a real (or dry-run, via `build --dry-run`-seeded) course generated through the
actual `/new` screen's SSE progress log rather than the harness CLI, and a real
`decompose_goal_into_path` call to replace the hand-constructed Path-view fixture with genuine
agent-generated data. The exact same "Options to actually close these out" list every prior
phase's README names applies unchanged.

### Documented gaps

- **No `generateStaticParams`/build-time prerendering** for any dynamic route — every page renders
  at request time. Reasonable for a genuinely single-user local app; revisit if this ever needs to
  serve a static/CDN-cached deployment.
- **The Path view's overlap-detection reasoning isn't shown per-topic**, only the status itself
  (`pending`/`linked_existing`/`delta_needed`/`mastered`, with a short static legend). The actual
  natural-language reasoning `resolveOverlapForTopic()` computes (`src/pathPlanner/overlap.ts`) is
  only ever a `[goal-harness]` progress-log line in the CLI harness — never persisted to the DB.
  Showing it in the UI would need a schema change (a `reason` column, or a new table), which this
  phase's "no new backend logic / no new DB tables beyond what's needed" scope boundary rules out
  without an explicit decision to add one. The status itself (the actual decision) is always shown
  directly, satisfying the PRD's "surface explicitly, don't apply silently" requirement at the
  decision level, just not at the full-explanation level.
- **Quiz answer payload round-trips `correctOptionIndex` to the client before scoring.** Harmless
  for a genuinely single-user personal tool (no adversarial multiplayer context — the CLI harness
  has the same full access), and stripping it would be a filtering step beyond what a thin wrapper
  does; noted rather than silently accepted as ideal.

## Phase 7.5: the Teaching Engine voice layer

Phase 7 shipped the Lesson/Teaching screen text-only, with one deliberate stub:
`<PlaceholderPanel label="Voice playback" note="Phase 7.5" />`. This phase fills that seam in two
stages, per PRD §5.6's own sequencing: a zero-cost browser-`SpeechSynthesis` prototype to prove
chunking and player UI, then production OpenAI TTS behind a swappable provider interface with
per-chunk disk caching. Socratic checkpoints stay text-input — voice is output-only this phase, no
speech-to-text (PRD §5.1/§5.6, explicit). No changes to `LayerViewer`'s own layer text/markup or
`answerLessonQuestion()`'s content pipeline beyond one small additive prop (below); no Mind Map,
Motivation Layer, or offline/PWA work.

### Chunking (`src/teachingEngine/chunkLessonAudio.ts`)

Pure function, no I/O. Splits each of a lesson's five depth layers into paragraph-sized chunks
(falling back to sentence-grouping when a single paragraph exceeds ~800 characters — comfortably
under OpenAI TTS's 4096-char `input` cap, and small enough that a chunk is a genuine listening
unit, not just the longest string that would technically fit), **per layer**, not the whole lesson
flattened. `LessonAudioTrack`/`LessonAudioChunk` are the vendor-neutral shapes both TTS stages
consume identically — only how a chunk's audio gets produced differs, same "swappable adapter"
discipline `SearchProvider`/`LLMProvider` already use elsewhere in this codebase.

### `TTSProvider` — mirrors `LLMProvider` exactly (`src/teachingEngine/tts/`)

One method, `synthesize(text): Promise<{audio: Buffer, contentType: string}>`. Selected via
`TTS_PROVIDER` (`openai` default, `browser` a manual dev opt-in — **no silent fallback**:
`openai` with no `OPENAI_API_KEY` fails loudly from `OpenAiTtsProvider`, exactly matching
`GeminiProvider`'s own unkeyed behavior, confirmed live below — it does not quietly switch to
`browser`). `getTtsProvider()` (`src/teachingEngine/tts/index.ts`) mirrors `getProvider()`
(`src/orchestrator/providers/index.ts`) including its cache-per-selected-name pattern.

- **`OpenAiTtsProvider`** (`openaiTts.ts`) — raw `fetch`, no `openai` SDK dependency (matching
  `fetchAndClean.ts`'s own no-SDK style for a single-endpoint integration). Confirmed directly
  from OpenAI's real API reference, not guessed: `POST https://api.openai.com/v1/audio/speech`,
  `Authorization: Bearer <key>`, body `{model, input, voice, response_format, speed}`, response =
  raw binary audio bytes by default. `stream_format: "sse"` exists upstream but is explicitly
  unsupported on `tts-1`/`tts-1-hd` — this project's default model — so no per-call streaming is
  attempted; "streaming, chunked by paragraph/section" (PRD §5.6) is achieved at the CHUNK level
  instead (see the audio route below), not within one call's response body. Default model
  `tts-1` ($15/1M characters — cost-optimal, vs. `tts-1-hd`'s $30/1M, both current pricing at the
  time of this build); `tts-1-hd`/`gpt-4o-mini-tts` are documented, swappable alternates via
  `OPENAI_TTS_MODEL` for anyone who wants the quality tradeoff. ElevenLabs stays a documented,
  swappable alternative via the same `TTSProvider` interface, not implemented this phase — OpenAI
  TTS alone satisfies the Definition of Done.
- **`BrowserTtsProvider`** (`browserTts.ts`) — a defense-in-depth SENTINEL, not a real server-side
  implementation: `window.speechSynthesis` is inherently a browser API and cannot run server-side.
  `TTS_PROVIDER=browser` is meant to keep the Lesson page's `AudioPlayer` entirely client-side and
  never call `/api/lessons/:id/audio` at all — confirmed live below (no `<audio>` element is even
  server-rendered in this mode). If a server call somehow reaches this provider anyway (a routing
  bug, not an expected path), it throws a clear, specific error rather than failing silently.

### Caching — per-chunk, no new table, keyed by content hash

`lessons.audioCacheRef` (`src/db/schema.ts`) has been reserved since Phase 3 for exactly this
("Not populated until the audio-caching phase; column exists now so the schema doesn't need to
change later"). Retyped as a Drizzle JSON column (`{mode: "json"}.$type<AudioCacheEntry[]>()`,
the same pattern `layers`/`sourceRefs` already use on this table) storing
`[{layer, chunkIndex, contentHash, filePath}, ...]` — real per-chunk granularity, since layers
reveal progressively (Phase 7's "one tap away" principle) and a collapsed formal/frontier layer
must never have its audio force-generated alongside the rest. **This needed no migration** — the
underlying SQL column stays `TEXT`; only the TypeScript-level type annotation changed. Confirmed,
not assumed: `npm run db:generate` was run after the schema edit and printed "No schema changes,
nothing to migrate."

`contentHash` (not `lessonId`+`layer`+`chunkIndex` alone) is the actual cache key — a SHA-256 of
the chunk's own text. A later content change (Phase 6's Knowledge Update Agent regenerating a
layer, for instance) naturally produces a different hash, so a stale entry is detected by hash
mismatch and re-synthesized automatically, with zero explicit coupling between the two phases.
Files live under `data/audio-cache/<lessonId>/<contentHash>.<ext>` on local disk — the PRD's pick
for a personal, single-user, local-first app, matching Phase 3's own "local-first, no extra infra"
reasoning for source-text caching (not R2/cloud storage). `src/teachingEngine/audioCache.ts`'s
`getOrSynthesizeChunk()` is the actual orchestration (check the DB index → verify the file's still
on disk → serve on a real hit; otherwise synthesize, write, and record) — `cacheDir` is injectable
for tests, same DI convention as `db` throughout this codebase.

### Audio delivery: per-chunk HTTP GET, not SSE — a deliberate divergence from Phase 7's precedent

`GET /api/lessons/:id/audio?layer=X&chunkIndex=N` returns raw bytes (`Content-Type: audio/mpeg`,
`Cache-Control: immutable` — safe indefinitely, since the cache key IS the content hash) rather
than streaming over Server-Sent Events. This is a real, considered departure from Phase 7's SSE
routes, not an inconsistency: those stream a TEXT PROGRESS LOG from one long-running server-side
job (course build, path decompose). Audio chunks are independent, cacheable BINARY resources — a
real HTTP GET gives the browser's own `<audio>` element and HTTP cache for free, rather than
base64-encoding audio into SSE frames and hand-rolling reassembly. `AudioPlayer`
(`components/AudioPlayer.tsx`) plays chunk N via a real `<audio>` element and prefetches chunk
N+1's URL in the background while N plays (a plain background `Audio()` load, relying on the
route's own cache header) — satisfying "begin playback of chunk 1 while chunk 2+ are still
generating" without needing OpenAI's own per-call streaming (which, as noted above, isn't even
available on the default `tts-1` model). `POST /api/lessons/:id/audio/adhoc` (uncached — a Q&A
answer is unique per question, so content-hash caching doesn't apply the same way) is the
voice-continuous Q&A path's equivalent, see below.

### The player (`components/AudioPlayer.tsx`) and the layer-gating it shares with `LayerViewer`

Controls per PRD §5.6/§6.3: play/pause, speed (1x/1.5x/2x — `<audio>.playbackRate` in "server"
mode, `SpeechSynthesisUtterance.rate` in "browser" mode), skip-back-10s (`<audio>.currentTime -=
10` in "server" mode; the Web Speech API has no real seek, so "browser" mode approximates this by
restarting the current chunk from its beginning — **a documented Stage-1-only limitation, not a
Stage-2 gap**). `AudioPlayer` only ever requests/synthesizes chunks for the `intuition` layer plus
— once expanded — every other layer, mirroring `LayerViewer`'s own "Go deeper" disclosure exactly.

Sharing that expand state required one small, additive change to `LayerViewer.tsx` (otherwise
untouched): an optional `onDeeperLayersToggle?: (open: boolean) => void` prop wired to the
existing `<details>` element's native `onToggle` — omitting it leaves Phase 7's behavior byte-for-
byte identical. `components/LessonAudioSection.tsx` is the small new client component that holds
this one piece of shared state and renders `AudioPlayer` + `LayerViewer` together, replacing both
the old `PlaceholderPanel` and the direct `LayerViewer` call in `app/lessons/[id]/page.tsx`. The
Lesson page (a Server Component) reads `TTS_PROVIDER` itself and passes a plain
`mode: "browser" | "server"` prop down — the client never needs the env var exposed to it (no
`NEXT_PUBLIC_` prefix needed), and in `"browser"` mode no `<audio>` element is even
server-rendered, confirmed live below.

**Media Session API** wiring (`navigator.mediaSession.metadata` + `setActionHandler` for
play/pause/seekbackward) applies in both modes where the browser supports it — this covers a
**backgrounded browser tab** (lock-screen/notification transport controls), not "app fully
closed"; that stronger guarantee needs Phase 10's PWA work or a native wrapper, both still out of
scope here, same as Phase 7's own scope boundary.

### Voice-continuous Q&A — a small, additive change to `LessonQA` (not a rebuild)

Per PRD §5.6's Teaching Engine pipeline step ("convert answer to audio if voice-continuous mode is
on, else return as text"): a "Speak answers" checkbox, **default off** (Phase 7's text-only
behavior is unchanged unless the learner opts in). When on, the answer text is spoken through the
same mode-aware path `AudioPlayer` uses — client-side `speechSynthesis` directly in `"browser"`
mode, `POST /api/lessons/:id/audio/adhoc` in `"server"` mode — reusing the same primitives rather
than a parallel implementation. `answerLessonQuestion()` itself is completely unmodified.

### Definition of done — Phase 7.5

**Real, live-confirmed behavior** (this environment has no `OPENAI_API_KEY` — see below — so
verification ran with `TTS_PROVIDER=browser`, which is also this environment's genuine real
dev-mode setting, not just a test config):

- The Lesson screen renders with the "Voice playback" placeholder genuinely GONE (confirmed by
  grepping the rendered page — zero matches) and the real player controls (`Play`, `-10s`, the
  speed selector, "Go deeper") and the "Speak answers" toggle present in its place.
- **Confirmed live that `"browser"` mode never touches the server audio route at all**: the
  rendered HTML contains no `<audio>` element whatsoever in this mode (grepped directly, zero
  matches) — the client genuinely has no URL to request from, not just "chooses not to."
- **Confirmed live that the "no silent fallback" design works exactly as intended**: with
  `TTS_PROVIDER` unset (falling back to its `openai` default) and no `OPENAI_API_KEY`, a real
  request to `/api/lessons/:id/audio` failed with a clear, specific, correctly-attributed error
  (`OpenAiTtsProvider.synthesize`: `"OPENAI_API_KEY is not set — cannot call OpenAI TTS."`, plus
  the constructor's own startup warning naming the `TTS_PROVIDER=browser` fix) — not a silent
  fallback, not an opaque crash.
- **Confirmed live, every validation/error branch of the audio route**: missing
  `layer`/`chunkIndex` query params → `400`; an unknown lesson id → `404`; a `chunkIndex` past the
  end of that layer's real chunk list → `404`.
- `npm test` — 220 tests total (208 through Phase 7 + 12 new: `chunkLessonAudio.test.ts` (pure,
  4 tests), `openaiTts.test.ts` (mocked `fetch`, 4 tests, confirming the exact request shape
  against OpenAI's real documented schema), `audioCache.test.ts` (4 tests: cache miss, cache hit
  with zero additional `synthesize()` calls, a content change correctly treated as a miss and
  replacing — not duplicating — the stale entry, independent entries accumulating per chunk)) —
  all pass. `npm run typecheck` clean across both configs.

**Stage 2 (OpenAI TTS): adapter-verified, not live-API-verified** — `OPENAI_API_KEY` is not
configured in this environment, the same real-run-blocker category Phases 2/3/5/6/7 already
documented (a missing credential/quota wall, not a code gap). What stands in as evidence, per this
project's own established convention: `tests/openaiTts.test.ts` proves the adapter's exact request
shape (`model`, `input`, `voice`, `response_format`, `speed`) against OpenAI's real, independently-
confirmed API schema, not a guessed one; the live error-path check above proves the surrounding
cache-then-synthesize orchestration genuinely reaches the provider boundary correctly and fails at
exactly the right, well-attributed point — everything up to the actual external HTTP call is real
and exercised, only the call itself is unverified live. **Cache-hit-avoids-re-calling-the-API** is
proven at the function level (`audioCache.test.ts`'s dedicated test, a fake provider whose call
count is asserted to stay at 1 across two requests for the same chunk) rather than against the
real OpenAI endpoint, for the same reason.

**Media Session**: wired per the API (`navigator.mediaSession.metadata`/`setActionHandler`) and
confirmed present in the rendered component tree, but **not manually verified on a real mobile
browser** — no browser automation tooling is available in this environment (checked: no
Playwright/Puppeteer installed), and there is no physical mobile device to test against here. This
is honestly reported as unverified-on-device rather than claimed; the implementation follows the
documented API directly and should be checked on a real phone browser (lock the screen or switch
tabs mid-playback; the lock-screen/notification transport controls should show and control
playback) before relying on it.

**What would still be worth doing once `OPENAI_API_KEY` is available**: one real
`synthesize()` call end-to-end through `/api/lessons/:id/audio`, confirming a real audio file
lands in `data/audio-cache/` and that a second request for the same chunk is a genuine cache hit
against the real file (not just the mocked-provider test); a real mobile-browser Media Session
check. The exact same "Options to actually close these out" framing every prior phase's README
uses applies unchanged.

### Documented gaps

- **No native mobile audio plugin (Capacitor)** and **no offline/PWA background-audio guarantee**
  — both explicitly out of scope this phase (PRD §6.3 names Capacitor as an option "if wrapped
  natively," which doesn't exist yet). Media Session covers a backgrounded browser tab only.
- **`BrowserTtsProvider` is a sentinel, not a real provider** — by design (`window.speechSynthesis`
  cannot run server-side). Documented plainly in its own file rather than left implicit.

## Phase 8: the Mind Map Agent, the React Flow viewer, and the starting menu

The Course view had stayed a plain module/lesson list since Phase 7, with its own comment pointing
here: "No mind map (Phase 8)." This phase builds the Mind Map Agent (PRD §5.12: one `[LLM]` call
converts a finalized course into a concept node/edge graph; `[code]` validates and persists it;
node STATE is computed at read time from `MasteryState`, never regenerated by the LLM) plus a
React Flow viewer, and bundles the self-improvement starting menu (PRD §6.2 screen 1) — curated
static content feeding the exact classify-confirm-override pipeline Phase 7 already built, needing
no new agent and no undecided onboarding data (PRD Open Decision 10 stays deferred to Phase 9).

### `mindMaps` schema — one JSON blob, not normalized tables (the PRD-Section-7 gap, again)

The PRD's Section 7 table has no "Mind Map"/"Graph" entity even though §5.5 clearly requires
persisting one — the same situation Phase 5 hit for `Path`. `mindMaps` (`src/db/schema.ts`):
`{id, courseId (unique — one static map per course), graphJson: {nodes, edges}, createdAt}`. No
separate node/edge tables: the graph is small (one course's concept nodes), regenerated wholesale
on a rebuild — never incrementally patched, matching §5.5's own "static per-course overview graph,
generated once at course creation" — and node STATE (not started/in progress/mastered) is
deliberately NOT stored here at all; it's computed at READ time from `masteryState` (PRD step 5),
so a mind map never goes stale just because mastery changed. Same deliberate v1 simplification as
Phase 6's "don't persist Suggestion records." This genuinely needed a real migration (confirmed:
`npm run db:generate` produced `drizzle/0004_damp_harrier.sql`, a real `CREATE TABLE` — unlike
Phase 7.5's column retype, which needed none).

### Node IDs are lesson IDs, strictly — the same tempId-verbatim-copy discipline as Phase 5/6

Every node's `lessonId` (and every edge's `source`/`target`) must be copied VERBATIM from the
course's real lesson list given in the prompt context — never invented. This is the identical
discipline `sequence_modules`' tempId pattern and `compare_findings_to_facts`' `relatedLessonId`
pattern already use elsewhere in this codebase: the model reports references, code validates them.
`createGenerateMindMapValidator` (`src/orchestrator/templates/generateMindMap.ts`, the same
`validateExtra` mechanism `research/grounding.ts`'s citation validator uses) rejects two things: a
node referencing a lesson outside the course, and an edge referencing a node not present in that
SAME graph's own `nodes` array (so the frontend never has to handle a dangling edge). A node's
`lessonId` set is a genuine SUBSET of the course's lessons — the model doesn't have to include
every lesson (several might really be facets of one bigger concept), but every node it does create
must be real. `conceptLabel` is the model's own short framing of the concept, which can differ
from the lesson's full title — real lesson data (title/mastery/freshness) is always joined in at
read time via the id, never trusted from the LLM.

### Mind Map call sites — a 4th step appended after `aggregateMaterials`, NOT inside `courseBuilder`

`generateMindMap()` (`src/mindMap/index.ts`) is called from `app/api/courses/build-stream/route.ts`
and the harness's `runBuildCommand` (`src/harness/cli.ts`) — a 4th step appended to the exact same
three-call chain (`runResearchPipeline` → `buildCourse` → `aggregateMaterials`) both already run,
not a change to `src/courseBuilder/index.ts` itself. This matches how Phase 3's own kickoff prompt
deliberately kept "triggers Material Aggregator + Mind Map Agent" out of that module — the actual
orchestration for this whole chain has always lived at the route/harness level, not inside any one
agent. A mind map failure degrades (logged as a progress line, the course generation chain still
completes and returns successfully) rather than failing the whole build — it's an enrichment step,
not a precondition for the course existing, the same policy every Memory Graph write already
follows. Idempotent via upsert (`onConflictDoUpdate({target: mindMaps.courseId, ...})`, the same
upsert shape `masteryState` already uses) — a re-run overwrites, confirmed live: generating a mind
map twice for the same course (once via the dry-run mock, once for real) left exactly one
`mindMaps` row, not two.

### `writeMindMapNodes` — one clearly-scoped Memory Graph method, mirroring `writeTopic` exactly

`src/memoryGraph/index.ts` gains `writeMindMapNodes(courseId, topic, nodes, edges)` rather than
overloading `writeTopic` — this module's own established "one clearly-scoped method per concern"
pattern. Same shape as `writeTopic`: one `add_memory` episode summarizing the map first, then one
`add_triplet` per edge (`MIND_MAP_PREREQUISITE` / `MIND_MAP_CROSS_LINK` depending on the edge's own
type, using each node's concept label — not its raw lesson id — as the triplet's endpoint names,
since that's what a later graph text search would actually match against). Degrades the same way
every other Memory Graph write does (logged, skipped) on failure — confirmed live, since this
environment still has no Docker running (same documented gap since Phase 3.5): every real mind map
generation in this phase's verification correctly logged the connection failure and moved on
without crashing course generation.

### The React Flow viewer — a plain grid layout, no auto-layout dependency

`components/CourseMindMap.tsx` renders the graph via `@xyflow/react`; the plain module/lesson list
is kept UNCONDITIONALLY below it (the graph panel only appears when a `mindMaps` row exists — a
reasonable fallback for a course built before this phase shipped, or one whose mind-map step
degraded). All the actual layout/state logic is deliberately extracted into a PURE function,
`computeMindMapLayout` (`src/mindMap/layout.ts` — no JSX, no CSS import, unlike the component
itself), specifically so it's unit-testable under this project's existing vitest setup without
adding component-testing infrastructure (`tests/mindMapLayout.test.ts`). No `dagre`/`elkjs`: column
= module (by the real, already-topologically-sorted `modules.order`), row = that module's lessons
that have a graph node — the graphs here are small (one course's concepts) and a plain grid reads
clearly without another dependency, consistent with this project's "don't add a library unless a
screen genuinely needs it" standard (Phase 7's own bar for state-management libraries).

- **Node state** reuses `masteryStatusFor`/`MASTERED_THRESHOLD` exactly — moved to
  `src/shared/mastery.ts` (re-exported unchanged from `components/MasteryBadge.tsx`, so every
  existing import keeps working) specifically so the pure, backend-testable
  `computeMindMapLayout` and the plain-list `MasteryBadge` component are provably using the SAME
  thresholds, not two copies that could drift.
- **Freshness indicator**: a node whose lesson has a Phase 6 `lessonUpdates` row shows a small dot.
  `getCourseMindMap()` (`src/db/queries.ts`) is a pure read against that table — no Phase 6 write
  path is touched.
- **Collapsed by module, by default** — a real interaction (toggle chips above the canvas), not a
  static grouping label. **An edge only ever renders once BOTH its endpoints are visible** —
  confirmed directly in `tests/mindMapLayout.test.ts`: collapsing a module can never leave a
  dangling half-edge on screen.
- **Click a node → `/lessons/:id`**, the same navigation target the plain list's links already use.

### Starting menu — fixed taxonomy, not generated (Open Decision 7)

`src/startingMenu/data.ts` — a hardcoded array, ~30 entries across the PRD's own 8 named
categories (mindset, focus, emotional intelligence, communication, health, financial literacy,
decision-making, career growth). No LLM call, no DB table: this is the "fixed curated taxonomy
(recommended for v1)" branch of Open Decision 7, not the "fully AI-generated dynamic menu" branch
(which would need Continuous Learning Agent logic earlier than phased). Surfaced on `app/new/page.tsx`
as a second section ("…or pick something to start with") below the free-text input — selecting an
entry just sets the SAME `input` state the free-text field uses, and the existing classify-confirm-
override flow runs completely unchanged. Most entries read as a single topic; a couple ("become
financially independent," "advance into a leadership role") are deliberately goal-shaped, matching
the PRD's own example — confirmed live below, both a real `topic` and a real `goal` classification.

### Definition of done — Phase 8

**Real, live-confirmed end-to-end, not dry-run-only**:

- Built a fresh dry-run course ("Quantum Computing Basics") through `npm run harness -- build
  --dry-run` — the mind map step ran as a real 4th chain step ("Generating mind map for... /
  Persisted mind map: 3 node(s), 2 edge(s)"), degrading the Memory Graph write cleanly (no Docker
  here) without breaking the overall build, which completed successfully with real module/lesson
  counts.
- **Confirmed directly against the database** (not just claimed): every mind map node id is a real
  lesson id belonging to that specific course — queried both tables directly and asserted the node
  id set is a genuine subset of the real lesson id set.
- **Then re-ran `generateMindMap` for the SAME course with the REAL Orchestrator** (real
  `GEMINI_API_KEY`, no mocking) — a genuinely different, sensible LLM-generated graph (concept
  labels like "Subtopic One Fundamentals" → "Subtopic Two Core Concepts" → "Subtopic Three
  Applications," chained by real `prerequisite` edges) passed the same node-id validation and
  persisted successfully. **Confirmed the upsert overwrote rather than duplicated**: exactly one
  `mindMaps` row remained for that course after both the mock and the real run.
- **Confirmed live in the rendered Course view** (`npm run dev`, real HTML inspection): the
  "Concept map" section renders, module toggle chips show the real module titles with the real
  per-module node counts (from `nodeCountByModule`), and start correctly COLLAPSED (no React Flow
  canvas mounted until a module is expanded) — matching the chosen default exactly. The plain
  list still renders below it, unconditionally, with real `MasteryBadge` states.
- **Constructed a real `UpdateEvent`/`LessonUpdate` pair** (Phase 6 data, same "deliberately
  constructed real record" approach Phase 5/6 used for their own hard-to-naturally-produce
  branches) for one of this course's lessons and confirmed `getCourseMindMap()` correctly reports
  that lesson's id in `updatedLessonIds`.
- **The interactive rendering itself** — expanding a module and visually confirming node colors/
  the freshness dot/click-navigation inside a live React Flow canvas — was **not** verified in a
  real browser; no browser automation tooling is available in this environment (same honest gap
  Phase 7.5 already hit for Media Session). What stands in as evidence, and is genuinely strong:
  the layout/state logic that decides exactly this (node positioning, mastery-status assignment,
  freshness flagging, and — critically — the "never a dangling edge" invariant at a collapse
  boundary) was deliberately extracted into a pure function specifically so it could be
  automated-tested rather than left as an unverifiable claim (`tests/mindMapLayout.test.ts`, 10
  tests covering every one of those branches directly), and the SERVER-rendered initial state
  (collapsed, correct chip counts/titles) was confirmed live as above — only the CLIENT-side canvas
  interaction itself is unverified-on-device.
- **The starting menu — both real classification outcomes, via the actual API route**: `POST
  /api/classify` with `"Growth mindset"` → real `{classification: "topic", reasoning: "...can be
  comprehensively taught as a dedicated subject..."}`; `"become financially independent"` → real
  `{classification: "goal", reasoning: "...requires mastering multiple distinct domains..."}` —
  both genuinely on-target, not asserted from the underlying function in isolation.
- `npm test` — 248 tests total (229 through Phase 7.5 + 19 new: `tests/mindMap.test.ts` (5, mocked
  LLM, including the node-ID-outside-course-lessons and dangling-edge rejections),
  `tests/mindMapLayout.test.ts` (10, pure), `tests/startingMenu.test.ts` (6), plus additions to
  `tests/memoryGraph.test.ts` and `tests/dbQueries.test.ts`) — all pass. `npm run typecheck` clean
  across both configs.

### Documented gaps

- **The interactive graph canvas isn't manually verified on a real device/browser** — see above;
  the pure layout logic it renders is fully tested, the interaction itself isn't. Worth a real
  click-through once browser automation or a real device is available.
- **No auto-layout library.** The grid is simple and deterministic, which is the right tradeoff for
  a single course's small concept graph, but won't produce an especially elegant layout for a
  course with many cross-links between distant modules. Revisit with `dagre`/`elkjs` if a real
  course's graph ever looks cluttered in practice — not something observed yet.

## Phase 9: the Motivation/Engagement Layer

Phases 1-8 built the full knowledge-delivery loop plus a real Mind Map and a starting menu. This
phase adds the layer PRD §5.12b treats as just as central as the content itself — momentum
framing, low-friction re-entry, boredom-proofing, and milestone celebration, on top of the
Dashboard's existing real data — plus the two structural pieces §5.12b is explicitly tied to:
real activity tracking and the onboarding goal capture Phase 8 deliberately deferred here. Every
deliverable below is held to §6.1's "no dark patterns" rule and §11's guiding principle: no
points, badges, leaderboards, or artificial urgency — streaks and milestones are the PRD's own
named mechanics, and this phase stops there.

### `ActivityEvent` / `UserProfile` — the Phase 9 gap-fill (same situation as `Path` and `MindMap`)

Neither table is in the PRD's Section 7 list even though §5.12b clearly requires both — the same
gap Phase 5 hit for `Path` and Phase 8 hit for `MindMap`. `activityEvents`
(`{id, eventType, entityId, courseId, occurredAt}`) is what streak/re-entry/boredom-proofing all
read from. `courseId` is stored on EVERY row regardless of `eventType` — a deliberate
denormalization: every real consumer needs to group/filter by course, and re-deriving that from
`entityId` (a lesson id for three of the four event types, a module id for the fourth) would mean
a different join per event type at every read site. `userProfile` is a **singleton row** — this
is an explicitly single-user app, so a `users` table with a foreign key everywhere would be pure
overhead with no second user to ever key against.

### Resolving PRD Open Decision 10

`statedGoals` (a JSON array of short free-text strings, not a structured taxonomy) is the concrete
resolution of Open Decision 10 ("full list of self-improvement goals/values to capture at
onboarding — deferred, decide as a single batch"). The onboarding screen (`app/onboarding/`,
Deliverable 1) asks 4 short prompts — "What are you hoping to get better at?", "Why does that
matter to you?", "Is there something specific you're working toward?", "What would 'better'
actually look like, a few months from now?" — each non-empty answer becomes one array entry.
§6.2 screen 1 calls for "short, honest capture," not a long form, and a small free-text list is
also simply enough for a single-user app: nothing downstream needs to parse or categorize these
beyond handing them, verbatim, to one LLM call (`connect_activity_to_goal`) as plain context.

### Onboarding gate — a Server Component read, not middleware

`app/page.tsx` calls `getUserProfile()` first and `redirect("/onboarding")` when it returns null —
a plain data check in the Dashboard's own Server Component, not Next.js middleware, consistent
with how the rest of the app reads state. Skipping onboarding still calls `saveUserProfile([])`,
so a row exists either way — the redirect fires exactly once per install, not on every visit.
`app/onboarding/page.tsx` doubles as the Dashboard's "edit what you're working toward" link,
pre-filled with whatever's already saved; the client component (`OnboardingClient.tsx`) shows
"Skip for now" (saves `[]`) on a genuine first run and "Cancel" (navigates away, saves nothing) on
a revisit, so editing existing goals can never be accidentally wiped by the wrong button.

### Where ActivityEvents are actually written from

Four real call sites, one per event type — `lesson_viewed` (`app/lessons/[id]/page.tsx`, on every
real page load), `quiz_completed` (`quizEngine.scoreAndRecordQuiz`), `practice_completed`
(`practiceEngine.recordPracticeAttempt`), `lesson_question_asked`
(`teachingEngine.answerLessonQuestion`). Each is one additive `recordActivityEvent()` call added
inside the function that already handles that real action — **not literally inside the thin API
route wrapping it**, which is a deliberate deviation from the kickoff prompt's own phrasing ("add
... at the existing API routes"): this codebase's actual convention (see `writeMasteryUpdate`) is
that routes stay thin wrappers and the owning engine function is where a real action's side
effects live, so `recordActivityEvent` was placed there instead, for the same reason. All three
engine functions gained an injectable `recordActivityEvent` option (mirroring `writeMasteryUpdate`
exactly) — but unlike the Memory Graph's best-effort writes, a failure here is **not** caught and
degraded; it's a plain insert into the same SQLite database every other write already depends on,
not an optional external service, so it should fail exactly like any other DB write failure would.

### The pure/impure split — `src/motivation/pure.ts` vs. `src/motivation/index.ts`

Same "hard logic is a pure function, DB/LLM parts are thin wrappers" split as Phase 5's
`computeCrossDomainOrder` and Phase 8's `computeMindMapLayout`. `src/motivation/pure.ts` holds
`computeStreak`, `selectWeakestConceptLesson`, `isPathInactive`, and `shouldShowGoalConnection` —
zero imports from any other agent module, so it can never form an import cycle with the engines
that call into it (quizEngine's own `DEFAULT_WEAK_CONCEPT_THRESHOLD` is passed IN by the caller,
never imported by `pure.ts` itself). The DB-composition reads the Dashboard actually calls
(`getMomentumStreak`, `getReentryOffer`, `getBoredomProofingSuggestions`) live in `src/db/queries.ts`
alongside Phase 8's `getCourseMindMap` — exactly the "cross-cutting reads for frontend screens"
role that file already has. `src/motivation/index.ts` holds the two genuinely stateful/LLM pieces
(`recordActivityEvent`, `getUserProfile`/`saveUserProfile`, `getGoalConnectionMessage`).

### Streak definition and the "no shaming" constraint

Consecutive **UTC calendar days** (not the learner's local timezone — a v1 simplification) with
at least one `ActivityEvent`, no distinction between event types. A streak whose most recent
activity was today OR yesterday still counts (no penalty for not having logged in yet today); once
the gap reaches 2+ days, `computeStreak` quietly returns `currentStreakDays: 0` — the Dashboard
simply omits the momentum line in that case (`streak.currentStreakDays > 0 && ...`), never a red
"you lost your streak" state or a comparison to a prior best. Confirmed live: aging every real
`ActivityEvent` back by 5 days made the momentum line disappear entirely, with no shaming copy or
styling anywhere on the page — verified by grepping the actual rendered HTML for "streak"/"lost"/
"broke", not just by reading the code.

### Low-friction re-entry — one existing quiz-generation path, parameterized

`getReentryOffer()` picks the single weakest-scoring lesson (`knowledgeScore` below quizEngine's
own `DEFAULT_WEAK_CONCEPT_THRESHOLD`, passed in) across every in-progress course. "Quick review"
links to that lesson's normal `/quiz/:id` (all three tiers, unchanged). "5-minute check-in" links
to `/quiz/:id?tier=recall&count=1` — `app/quiz/[lessonId]/page.tsx` reads those two query params
and passes `tiers`/`questionsPerTier` down to `QuizClient`, which threads them into the SAME
`/api/quiz/:id/generate` call every other quiz session uses (the route now also accepts an
optional `questionsPerTier` in its body, alongside the `tiers` it already took) — `generateQuizQuestions`
already supported both parameters internally; only the route's body shape and the client's props
needed extending. No second quiz-generation path anywhere.

### Boredom-proofing — reusing Phase 6's diversity signal, not a second one

`isPathInactive` (pure): a path is "gone quiet" only when it has no `ActivityEvent` on any of its
own courses in the inactivity window (`DEFAULT_BOREDOM_INACTIVITY_DAYS`, default **7 days**) WHILE
the app has real activity elsewhere in that same window — a learner who simply hasn't opened the
app at all doesn't trigger this for any one path, by design. The "change of pace" framing reuses
Phase 6's `getRecentCourseDomains` + `isDomainClusterNarrow` (`src/continuousLearning/index.ts`)
verbatim to pick between two static copy strings — not a second diversity algorithm, and not a new
LLM call of its own. `getRecentCourseDomains` DOES make a real `infer_course_domain` LLM call per
completed course that isn't Path-linked, though, and this runs on **every** Dashboard load — so
that step is wrapped and degrades to the plain (non-diversity-biased) copy on failure rather than
taking the whole Dashboard down. This was a real bug caught during live verification, not a
hypothetical: a fresh dev-server run with a real `infer_course_domain` call missing valid
credentials produced a genuine 500 on `/` before the fix, fixed by wrapping that one call.

### Milestone celebration — exactly two triggers, both real

Reuses Phase 5's own "high score" bar (`DEFAULT_HIGH_SCORE_THRESHOLD`, 0.75,
`src/pathPlanner/overlap.ts`) rather than inventing a third threshold, per the kickoff's explicit
instruction. `quizEngine.isTransferHighScoreAchieved` (pure, newly extracted) and the existing
`courseCompleted` trigger (`checkAndMarkCourseCompletion`, already wired since Phase 6) are the
**only** two triggers — both are returned from `scoreAndRecordQuiz`'s existing response, so no new
API route was needed. `QuizClient.tsx` renders a single, visually distinct banner (a bordered,
accent-tinted block, above the routine tier breakdown) when EITHER fires, and nothing extra when
neither does — confirmed live via real API calls: a routine recall-tier result returns
`transferHighScoreAchieved: false` with no `courseCompleted`; a real transfer-tier answer scored
`transferHighScoreAchieved: true`; and completing the last missing tier across a real 3-lesson
course's 3 lessons returned a real `courseCompleted` course id.

### Goal-connection cadence and its own failure-isolation

`shouldShowGoalConnection` (pure): roughly once per real day (`DEFAULT_GOAL_CONNECTION_MIN_HOURS`,
default 20h) via `UserProfile.lastGoalConnectionShownAt` — a lightweight last-shown timestamp, not
a notification-scheduling system, per §5.12b's own word "occasional[ly]." `getGoalConnectionMessage`
runs from the Dashboard's Server Component read on every load, so its one real `[LLM]` call
(`connect_activity_to_goal`, a new Orchestrator template) is wrapped and degrades to `null` on
failure — the same reasoning as the boredom-proofing fix above, caught and fixed the same way
during the same live-verification pass, before it could ever reach a real user.

### The spaced-repetition substitution (documented plainly, per the kickoff's own instruction)

There is no spaced-repetition scheduling system anywhere in this codebase, and this phase doesn't
add one — the PRD's own UI-copy example ("Quick review," not "Spaced repetition module") and
Dashboard mockup imply a system that was never actually specified as an agent or built. "Quick
review" and "5-minute check-in" are real, useful low-friction re-entry options built from data
that's genuinely available today (the weakest scoring concept node) — not spaced-repetition
scheduling, which would need real per-lesson review-interval state this phase deliberately doesn't
introduce.

### Definition of done — Phase 9

**Real, live-confirmed end-to-end**, via a real dry-run-seeded course (`npm run harness -- build
--dry-run`) served by a real dev server pointed at that database, driven entirely through the
actual HTTP routes (not the underlying functions directly):

- A fresh load of `/` (no `UserProfile` row) returned a real `307` to `/onboarding`; completing
  onboarding via a real `POST /api/onboarding` call made `/` return `200` immediately after, with
  no further redirect on reload.
- A real `GET /lessons/:id` page load wrote a real `activity_events` row (confirmed by querying
  the database directly, not by trusting the route's response) — then the Dashboard's momentum
  line showed "1 day of momentum." Aging that same real row back by one real day (simulating it
  having happened "yesterday") and adding a second real row for "today" made the line read
  "2 days of momentum" — the streak display genuinely changing across two simulated days of real
  activity, per the kickoff's explicit bar.
- Aging every real event back by 5 days made the momentum line disappear entirely — confirmed by
  grepping the rendered HTML for any shaming language, not just by inspecting the source.
- A real goal-connection message rendered on the Dashboard, generated by a real (non-mocked)
  Gemini call grounded in the real `statedGoals` saved during onboarding and the real most-recent
  course studied.
- Both re-entry offers were clicked through for real: "Quick review" and "5-minute check-in" each
  loaded `/quiz/:id` and generated real, correctly-scoped question sets via the real
  `/api/quiz/:id/generate` route (the check-in genuinely returned exactly one recall-tier
  question, not the full six).
- Boredom-proofing: a real `Path`/`PathDomain`/`PathTopic` was constructed (the same "deliberately
  constructed real record" approach Phase 5/6/8 used for their own hard-to-naturally-produce
  branches) linking to a course with zero activity, alongside real recent activity on other
  courses — the Dashboard correctly flagged only the quiet path, with a real "gone quiet" message
  and a working "Explore something new" link to `/new`.
- Milestone celebration: a real transfer-tier question, answered correctly via the real scoring
  route, returned `transferHighScoreAchieved: true`; completing the final missing tier across a
  real 3-lesson course returned a real `courseCompleted` course id in the same response shape
  `QuizClient` already reads. A routine recall-tier result in the same session returned both
  fields false/absent, confirming no celebration fires for ordinary results.
- **Two real bugs were caught and fixed during this same live-verification pass** (not found by
  unit tests, which mock every LLM call by design): `getGoalConnectionMessage` and
  `getBoredomProofingSuggestions` each made a real, unguarded Orchestrator call from a Server
  Component page read that runs on every Dashboard load — a transient failure in either would have
  taken the ENTIRE Dashboard down with a 500, which is exactly what happened once, live, before
  the fix. Both are now wrapped and degrade to a safe default (`null` / the non-diversity-biased
  copy) on failure, matching the "an enrichment step, not a precondition" policy this codebase
  already applies to Phase 8's mind map generation and every Memory Graph write.
- `npm test` — 295 tests total (248 through Phase 8 + 47 new: `tests/motivationPure.test.ts` (19,
  pure, no DB/LLM), `tests/motivation.test.ts` (9, including the goal-connection degradation
  case), plus additions to `tests/quizEngine.test.ts`, `tests/practiceEngine.test.ts`,
  `tests/answerLessonQuestion.test.ts`, and `tests/dbQueries.test.ts`, including the
  boredom-proofing degradation case) — all pass. `npm run typecheck` clean across both configs.

### Documented gaps

- **No real browser click-through of the milestone banner or the onboarding form's actual
  rendering** — same category of gap as Phase 7.5/Phase 8, no browser automation available in this
  environment. The data these screens render was confirmed correct and real at every layer below
  the final paint (API responses, rendered HTML/RSC payload); the pixels themselves aren't
  screenshotted.
- **`lesson_viewed` can, in principle, over-count from Next.js Link prefetching** a lesson page a
  learner never actually opens. This is low-stakes here: streak/re-entry/boredom-proofing only
  need "was there real activity on this day/course," not a precise view count, so an occasional
  prefetch-triggered row doesn't change any real decision this phase makes.

## Phase 10: Mobile — PWA, offline mode, background sync, and real push

The last item on the PRD's core roadmap before Phase 11's polish pass: installability, one-handed
phone usability, offline access to already-downloaded content, background sync of what gets queued
while offline, and turning Phase 9's own "no real push notifications" scope note into a real one —
plus the Knowledge Update Agent's own long-deferred "push notifications are a later upgrade"
(§5.10). No new content or agent logic anywhere — every module from Phases 1-9 is untouched; this
phase is entirely about *delivery*.

### Service worker tooling: hand-rolled, not next-pwa/Workbox

This project already pins a deliberately customized webpack config (`next.config.ts`'s
`resolve.extensionAlias` fix, documented since Phase 7, for NodeNext `.js`-extension imports).
`next-pwa`'s own webpack plugin has a real history of fighting custom webpack configs and lagging
Next.js major-version support — not a risk worth taking for a personal, single-deployment app.
`public/sw.js` is a hand-rolled CLASSIC script (not `{type: "module"}`) — module service workers
aren't supported everywhere (notably older Safari), and classic scripts are also what Background
Sync/Push need broad support for anyway. Zero new dependencies. It handles four real concerns:
generic network-first-with-cache-fallback for same-origin GETs (what makes previously-cached pages
readable offline), a `message` handler for explicit pre-caching/clearing of a course's real page
and audio URLs (Deliverable 3's download/remove actions), a `push`/`notificationclick` pair
(Deliverable 5), and a `sync` handler (Deliverable 4). It duplicates a small slice of
`lib/offline/db.ts`'s IndexedDB shape by necessity — a classic-script SW can't `import` the page's
ES module, so its own outbox-processing code re-opens the same database directly.

### Where offline code lives and why (a real TypeScript-config constraint, not a style choice)

`tsconfig.backend.json` (covering `src/` and `tests/`) has `lib: ["ES2022"]` — **no DOM types at
all**. Any file under `src/` that referenced `indexedDB`, `Blob`, `PushSubscription`, or similar
would fail backend typecheck. So every genuinely browser-only piece — the real IndexedDB wrapper,
the download/sync glue, every new component — lives under `lib/offline/` or `components/`
(both covered by `tsconfig.json`, which DOES include `dom`), never under `src/`. The one exception
is `src/offline/outbox.ts` — deliberately kept in `src/` because it's genuinely pure (no DOM refs
at all) and needs to be reachable from `tests/` the same way every other pure module in this
codebase is (see the Phase 5/8/9 precedent: hard logic is a pure function, browser/DB/LLM parts are
thin wrappers around it — `lib/offline/sync.ts`'s `attemptSync()` is that thin wrapper here).

### Responsive pass (Deliverable 1)

Audited every Phase 7-9 screen at a phone-width viewport and fixed what was actually broken, not a
redesign: `CourseMindMap` now collapses to a drawer below Tailwind's `sm` (640px) breakpoint — a
`matchMedia` check (not a CSS-only trick, since the drawer's open/closed state also gates whether
React Flow even mounts) behind a "View concept map" toggle, per §6.3's explicit requirement.
`AudioPlayer`'s Play/Pause/-10s/speed controls all gained a real `min-h-11 min-w-11` (44px) touch
target — the size iOS/Android's own accessibility guidelines treat as the real minimum, not just
"technically clickable." The header nav also picked up a `flex-wrap` + tighter mobile padding pass
opportunistically while touching `app/layout.tsx` for the service worker registration anyway.

### A real bug this phase's own `next build` check surfaced (not introduced by this phase)

`npm run dev` never statically prerenders, so nobody had run a real `next build` and inspected its
route table since the Dashboard started reading real DB state in Phase 7. It turns out `app/page.tsx`
and `app/onboarding/page.tsx` were BOTH being silently prerendered as static HTML at build time —
`node:sqlite` reads are invisible to Next's static/dynamic heuristics (unlike `cookies()`/
`headers()`/an uncached `fetch`), so Next had no signal these pages needed per-request rendering.
In a real production build, this would have frozen the Phase 9 onboarding-redirect and every real
Dashboard figure to whatever the database looked like at BUILD time, not per real request — a
genuine, previously-invisible correctness bug, not something introduced by this phase. Fixed with
`export const dynamic = "force-dynamic"` on both files; confirmed via two full `next build` runs
(the route table showed `○ /` / `○ /onboarding` before the fix, `ƒ /` / `ƒ /onboarding` after).

### Background audio playback (Deliverable 2) — verification, not a rewrite

Phase 7.5's Media Session wiring (`AudioPlayer.tsx`) already covered a backgrounded BROWSER TAB;
its own README flagged "app fully closed" as needing PWA infra it didn't have yet. That infra is
exactly `app/manifest.ts`'s `display: "standalone"` plus a registered service worker — once
installed, the page runs as a persistent top-level browsing context rather than a backgroundable
tab, which is the actual mechanism the gap was about. No changes to the Media Session hooks
themselves were needed or made (per the kickoff's own instruction not to rework a verified phase's
player beyond what's needed) — the ONE real addition is `AudioPlayer` now resolving a downloaded
chunk's audio from its real IndexedDB Blob first, network second (see Deliverable 3), so playback
genuinely doesn't depend on the service worker's own opportunistic response cache surviving
storage pressure. **Not verified live on a real installed PWA on a real device** — no such device
is available in this environment; this is the one Deliverable 2 DoD item left honestly unverified,
same category of gap as Phase 7.5's own original one.

### Offline download + IndexedDB (Deliverable 3)

`GET /api/courses/:id/download` bundles a course's real modules/lessons/layers, a fresh
`generateQuizQuestions()` call per lesson across all three tiers (a real LLM cost, the SAME one a
learner would incur taking that quiz normally — there's no persisted question-bank table to read
from instead; caching happens client-side, in IndexedDB, not as a new server table), the real
persisted mind map graph (Phase 8), and a list of ALREADY-cached audio chunk URLs from Phase 7.5's
`lessons.audioCacheRef` — **never** a chunk that would need synthesizing (a course whose lessons
have no server audio cache yet, or one running `TTS_PROVIDER=browser`, simply downloads with fewer
or zero audio chunks; no new TTS call is ever triggered by a download). `lib/offline/db.ts`
mirrors the relevant slice of `src/db/schema.ts`'s real tables (`courses`/`modules`/`lessons`/
`quizQuestions`/`mindMaps`/`audio`) rather than a redesigned shape, plus `outbox` (Deliverable 4)
and `downloads` (a per-course summary: real size, real lesson ids, and every URL — page AND audio —
the service worker cached for it, so removal can clear exactly those Cache API entries too, not
just IndexedDB's own share of the space). `downloadCourse()` (`lib/offline/download.ts`) is the one
real download action, reused unchanged by both `DownloadCourseButton` (Course view) and
`DownloadPathButton` (Path view, looping it once per course in the path — not a second mechanism).

Offline reads: a downloaded lesson/quiz/mind-map's PAGE is served by the service worker's cached
response (pre-fetched via a `CACHE_URLS` message at download time, covering `/courses/:id`,
`/lessons/:id`, and `/quiz/:id` for every lesson) — the same generic network-first-with-fallback
strategy that makes any previously-visited page work offline, just triggered explicitly and in
advance rather than incidentally. Audio plays from the real downloaded Blob (see Deliverable 2
above). Quiz-taking offline reads its pre-generated question set from IndexedDB (`QuizClient`'s
`start()` falls back to `getOfflineQuizQuestions()` on a real network failure) — see Deliverable 4
for how scoring works without a connection.

**Storage management** (`/downloads`, `DownloadsManager.tsx`): real IndexedDB reads, real per-course
size (audio Blob bytes + the structured JSON's own serialized size — a real, if not byte-exact,
figure), and a real "Remove" action that clears every store's rows for that course AND messages the
service worker to clear its own cached page/audio entries for it (`CLEAR_URLS`) — both halves of
the space a download actually used.

### Background sync for queued offline actions (Deliverable 4)

Per §6.4's own hard boundary, exactly two things get queued: a mid-lesson question
(`LessonQA.ask()`) and a quiz submission (`QuizClient.submit()`) — both need a real `[LLM]` call
(a brand-new question's answer; a free-text answer's semantic score) that genuinely can't run
offline. The pure resolve-on-reconnect core, `resolvePendingItems` (`src/offline/outbox.ts`), takes
a plain item list and a `post` function and is directly unit tested with a mocked network (no real
browser/IndexedDB needed) — `lib/offline/sync.ts`'s `attemptSync()` is the thin real wrapper around
it (real IndexedDB reads, real `fetch`). Critically, a queued item resolves against the SAME real
route (`/api/lessons/:id/ask`, `/api/quiz/:id/score`) an online action already uses — Phase 9's
`recordActivityEvent`, milestone checks, and MasteryState updates all fire for real once it
actually sends, never a parallel sync-only path that could drift from the online one.

- **Quiz submitted offline**: multiple-choice questions get a REAL provisional score immediately
  (client-side, the exact same `selected === correctOptionIndex` rule `scoreAndRecordQuiz` uses
  server-side) so the learner isn't left with nothing; free-text questions can't be scored without
  the server's semantic grader, so the whole session shows "Pending — will sync when back online"
  rather than a fabricated number. The full real payload is queued regardless of question mix.
- **A question asked offline**: shown as "Queued — will answer when back online," never silently
  dropped or shown as a generic error.
- **Background Sync API**, registered right after queuing (`registerBackgroundSync()`) — real
  support was confirmed absent in one major real-world browser this project has to account for:
  Safari/iOS has no Background Sync API at all (a well-documented, permanent WebKit gap, not a
  version-lag issue). The documented fallback: the page's own `online` event listener
  (`ServiceWorkerRegister.tsx`) calls the exact same `attemptSync()` the service worker's `sync`
  handler uses — covers every browser, at the cost of only syncing while a tab is actually open.

### Real push notifications (Deliverable 5) — exactly the two named use cases, nothing else

`pushSubscriptions` (a dedicated table, not a `userProfile` column, per the kickoff's own resolved
default — a single user can still reasonably have more than one subscribed device) plus
`userProfile.lastEngagementNudgeSentAt` (the second cadence gate, alongside Phase 9's
`lastGoalConnectionShownAt`). `src/push/index.ts` wraps the `web-push` npm package (the standard
VAPID-based choice — no reason to hand-roll the protocol) behind `sendPushToAllSubscriptions()`,
injectable exactly like every other external-service call in this codebase (`orchestratorRun`,
`writeMasteryUpdate`); a subscription the push service reports gone (410/404) is deleted outright,
any other per-subscription failure is logged and skipped — one dead subscription never blocks
delivery to the rest.

- **Knowledge Update major-severity delta** (§5.10's own "push notifications are a later upgrade" —
  this is it): `checkTopicForUpdates` (`src/knowledgeUpdate/index.ts`) sends a real push right where
  it already writes the major `UpdateEvent`/generates the delta lesson — wrapped in try/catch so a
  push failure never fails the topic's real work, confirmed live (a dry run with real VAPID
  env vars unset produced exactly the expected non-fatal "Push notification failed" log line, the
  rest of the run completing normally).
- **The engagement nudge, now real** (`src/engagementCheck/`, `npm run engagement-check`) — its own
  scheduled-job script, mirroring `knowledge-update`'s exact "cron entry, not a persistent daemon"
  shape (§6.4's "no heavy job-queue infra" guidance), deliberately separate since the trigger
  condition is unrelated to topic staleness. Reuses Phase 9's OWN `isPathInactive` verbatim, scoped
  per active Path (`findInactivePathForNudge`) — not a second inactivity detector, and this specific
  script skips the diversity-signal LLM call the Dashboard's sibling boredom-proofing read makes,
  so it never calls the LLM at all. The "at most one" cadence (`isEngagementNudgeDue`,
  `src/motivation/pure.ts`) compares the FLAGGED PATH's OWN most recent `ActivityEvent` against
  `lastEngagementNudgeSentAt` — deliberately not a global/app-wide timestamp, which would let any
  OTHER active path's recent activity wrongly suppress a real nudge about a genuinely quiet one (a
  real design bug caught and fixed during this phase's own test-writing, before it shipped).

**Definition of done — Phase 10**

- Real, end-to-end confirmed via a real dry-run-seeded course through a real dev server (manifest,
  service worker, and every new route hit through real HTTP, not called directly): `GET /` redirects
  to onboarding pre-profile exactly like Phase 9 (now genuinely per-request, post-fix); `/manifest.
  webmanifest` serves real, correct JSON; `/sw.js` serves real content with the right
  `Content-Type`; `/downloads` renders; `GET /api/push/vapid-public-key` correctly 503s with VAPID
  unset and would 200 with real keys (see below).
- **A real, non-mocked `npm run engagement-check` run against a constructed real inactive-Path
  scenario** (a real `Path`/`PathDomain`/`PathTopic` linked to a quiet course, real recent
  `ActivityEvent`s elsewhere) fired a real, tone-correct nudge on the first run and correctly
  no-opped (`reason: cadence_not_due`) on an immediate second run against the same stretch —
  the "at most one... even across multiple scheduled-check runs" DoD bar, demonstrated live, not
  just asserted by the unit tests.
- **Real VAPID keys** were generated (`npx web-push generate-vapid-keys`) and configured; a real
  `sendPushToAllSubscriptions()` call with zero subscriptions returned `{sent: 0, removedStale: 0}`
  cleanly, and with one subscription (necessarily a fabricated one — no real subscribed browser is
  available in this environment) the REAL `web-push` library's own real cryptographic validation
  correctly rejected the malformed key and the failure was caught and logged, not thrown — real
  VAPID signing and the real send path are confirmed working; delivery to an actual device is not.
- **The download bundle's assembly logic was verified with a mocked Orchestrator** (real DB, real
  `generateQuizQuestions`/`getCourseMindMap`, a mocked LLM call) after the real Gemini free-tier
  daily quota (20 requests/day) was exhausted by this session's own testing — confirmed real
  module/lesson enumeration, 3-tier question generation per lesson, real mind map retrieval, and
  correct page-URL construction. **The download route's actual real, non-mocked LLM call was not
  exercised live in this session** — a genuine real-run-blocker (quota, not code), same category as
  every prior phase's own quota-exhaustion note; the route's logic is otherwise the same
  `generateQuizQuestions`/`getCourseMindMap` calls already covered elsewhere in this codebase's real
  verification history.
- A real production `next build` was run twice (once surfacing the static-rendering bug above, once
  confirming the fix) — every new route compiles and appears in the route table with the expected
  static/dynamic classification.
- **Not verified live, honestly**: real PWA installability ("Add to Home Screen") on a real mobile
  browser, real offline airplane-mode behavior end-to-end, real background-audio-while-backgrounded
  on an installed PWA, a real queued item actually resolving via a real Background Sync event, and
  real push delivery to a real subscribed device — none of these are reachable without a real
  mobile browser/device, which this environment doesn't have. Every one of them rests on code paths
  that ARE independently verified here: the manifest/service-worker/routes are real and serve
  correctly, the outbox's resolve logic is unit tested, the cadence logic is both unit tested and
  live-confirmed against constructed data, and real VAPID signing is confirmed working.
- `npm test` — 323 tests total (295 through Phase 9 + 28 new): `tests/offlineOutbox.test.ts` (5,
  pure resolve-on-reconnect logic), `tests/push.test.ts` (11, payload construction + subscription
  CRUD + send/stale-cleanup, all DB-real/network-mocked), `tests/engagementCheck.test.ts` (7,
  including the "at most one" cadence across repeated runs and a fresh-activity-resets-eligibility
  case), plus additions to `tests/motivationPure.test.ts` (`isEngagementNudgeDue`) and
  `tests/knowledgeUpdate.test.ts` (the real major-severity push trigger and its failure isolation)
  — all pass. `npm run typecheck` clean across both configs.

### Documented gaps

- **No real mobile device/browser anywhere in this environment** — the single biggest gap this
  phase has, honestly: installability, offline-mode-via-airplane-mode, backgrounded-PWA audio,
  real Background Sync delivery, and real push delivery to a device all need one, and none is
  available. Every one of these rests on independently-verified pieces (see the DoD section above)
  but the actual end-to-end, on-device experience is unverified. Worth a real device pass before
  this ships to actual daily use.
- **The real Gemini free-tier daily quota (20 req/day) was exhausted by this session's own testing**
  before the download route's real (non-mocked) LLM call could be exercised live — see the DoD
  section. Worth a real run once quota resets.
- **Safari/iOS has no Background Sync API** — a permanent platform gap, not a version-lag issue.
  The `online`-event fallback (`ServiceWorkerRegister.tsx`) covers it, at the cost of only syncing
  while a tab is actually open on that platform, rather than in the background.

## Phase 11: the polish pass

The last item on the PRD's roadmap. All ten functional phases were built and individually
verified; this phase is a fresh look at the whole app as one thing a real person uses daily — no
new agents, screens, or data model, per its own explicit scope boundary. Every deliverable below
came from an actual audit of the codebase as it stood after Phase 10, not a generic checklist.

### Loading and error boundaries — and a real bug the restructuring caught

`app/error.tsx`, `app/global-error.tsx`, and `app/not-found.tsx` now exist, styled in the existing
design system. Loading UI turned out to need real care, not a mechanical `loading.tsx` per route:
adding a route-level `app/loading.tsx` wraps that ENTIRE route segment in a React `<Suspense>`
boundary, including any `redirect()`/`notFound()` call in the page above it — and once a Suspense
boundary exists anywhere in the tree, Next flushes a 200 response immediately (to start streaming
the fallback) rather than waiting to see if the page redirects or 404s first. Confirmed live, and
it was a real regression: adding `app/loading.tsx` made a fresh, no-`UserProfile` `GET /` return
**200 with the Dashboard's content** instead of the real `307` to `/onboarding` this app had
returned at every prior phase's verification, and made `GET /courses/:bad-id` return 200 instead
of a real 404 — both silently downgraded to a client-JS-driven "soft" navigation instead of a true
HTTP status. Fixed by NOT giving the Dashboard, Course view, or Path view a route-level
`loading.tsx` at all; the Dashboard instead does its fast, gating `getUserProfile()` check first
(so a redirect still fires before any streaming starts), then wraps only the slow, non-gating
content (`DashboardContent`, the real eight-way `Promise.all`) in its own inline `<Suspense>` —
giving the slow part a real loading skeleton while keeping the redirect's real HTTP semantics.
Confirmed via a real production build + server (`next build && next start`, not `next dev`, since
dev mode's own error overlay masks this class of bug): `GET /` → real `307`, `GET
/courses/does-not-exist` → real `404` with the styled `not-found.tsx` content actually present in
the raw HTML. `error.tsx`'s own styled fallback is a CLIENT component by Next's own requirement,
so it renders after hydration — confirmed via a real thrown error that a production build/server
correctly wired to the compiled `error.tsx` bundle with a real error digest, but the actual
rendered pixels need a real browser executing JS to see directly (documented as a gap below, same
category as every prior phase's "no real browser" note).

### Accessibility pass

A manual review plus a real automated check — no Lighthouse (needs a real Chrome instance, absent
in this environment, same as every prior phase's "no browser" note), so `axe-core` run directly
against real server-rendered HTML (a production build/server, real pages fetched via HTTP, parsed
into `jsdom`, `axe.run()` against the real resulting DOM) instead. This genuinely caught two real
bugs, not just cosmetic labeling gaps:

- **The Dashboard had no `<h1>` at all** (only `<h2>` section headers) — added a visually-hidden
  `<h1>Dashboard</h1>`.
- **The Lesson screen skipped a heading level** (`<h1>` lesson title straight to `<h3>` for
  "Intuition"/"Mechanics"/etc. and "Ask a question") — a real `heading-order` violation `axe-core`
  flagged directly, fixed by promoting those to `<h2>`; the Dashboard's "Completed courses" list
  had the same `<h2>` → `<h4>` skip in `SuggestionsPanel`, fixed the same way.

Beyond those two, added real `aria-label`s on every icon-abbreviated control (`AudioPlayer`'s
Play/Pause/-10s/speed, `DownloadsManager`'s per-course Remove), `aria-live` regions for state that
updates without a page navigation (`AudioPlayer`'s current-chunk announcement, the progress log,
queued/pending states in `LessonQA`/`QuizClient`/download buttons), real `<label htmlFor>`/`id`
pairings everywhere a `<label>` was a sibling rather than wrapping its input (onboarding's
textareas, the Quiz screen's free-text answers, the `/new` and practice-turn inputs — none of
these were programmatically associated before, despite looking correct visually), `role="alert"`
on every error message across the app (previously color-only), and a `role="radiogroup"` +
`aria-labelledby` pairing each multiple-choice question's options to its own prompt text.
`components/PlaceholderPanel.tsx` — Phase 7's original stub, fully superseded by Phase 7.5/8/9's
real UI and no longer referenced anywhere except historical comments — was deleted as a byproduct
of this same pass, per this codebase's own "delete confirmed-unused code" convention.

**Before/after, real numbers**: `axe-core` against 7 real representative pages (Dashboard,
onboarding, `/new`, Course view, Lesson view, Quiz screen, Downloads) found **1 real violation**
(the Lesson screen's `heading-order` skip) before this pass and **0 violations** after, across
foundational rules — real DOM structure/semantics, not just visual similarity to an
accessible-looking page. `color-contrast` was excluded from the automated run (deliberately, not
silently): `jsdom` does no real CSS layout or paint, so a contrast check against it would report a
misleading pass/fail rather than a real measurement — this needs a real browser to check
honestly, and is the one accessibility area left to manual/future verification. Two `incomplete`
(not failed) findings — `landmark-one-main` and `page-has-heading-one` — appeared on every single
page, including ones manually confirmed to have both a real `<main>` (`app/layout.tsx`) and a real
`<h1>`; this is `axe-core`'s own visibility-detection uncertainty under `jsdom`'s lack of real
layout, not a real gap, and is called out here rather than silently treated as a pass.

### Lint setup — two real, confirmed tooling incompatibilities, and a user-approved fix

Confirmed gap: no `.eslintrc*`/`eslint.config*` and no `lint` script existed anywhere — this repo
was hand-built, never scaffolded via `create-next-app`. Setting it up hit two real, back-to-back
compatibility problems, not just "run install and go":

1. **`typescript-eslint` doesn't support TypeScript 7.0** (this project's installed version) —
   confirmed as a hard runtime check, not a warning, against the latest stable `typescript-eslint`
   release at the time. This is a genuine, current ecosystem gap (TS 7 is a very recent Go-based
   rewrite the JS tooling ecosystem hadn't caught up to yet), not a resolvable version pin. Given
   the real tradeoff — downgrade a foundational devDependency vs. leave lint non-functional — this
   was put to the user rather than decided unilaterally; **the user chose to downgrade**.
   `typescript` is now pinned to `6.0.3` (the latest pre-7 stable release) — a dev-only,
   easily-reversible change, verified safe by re-running the FULL typecheck and test suite
   immediately after and confirming byte-identical results (still clean, still 323/323).
2. **`eslint-config-next`'s flat configs can't be loaded through `@eslint/eslintrc`'s
   `FlatCompat.extends()`** — that shim exists to translate legacy `.eslintrc`-shaped configs into
   flat config, but this version of `eslint-config-next` already ships NATIVE flat config (each
   subpath export, e.g. `eslint-config-next/core-web-vitals`, is already a flat config array), and
   running an already-flat config back through the legacy-format translator produced a real
   `TypeError: Converting circular structure to JSON` crash — confirmed by isolating it (removing
   `next/typescript` didn't help; the crash came from `core-web-vitals` alone). Fixed by importing
   the flat config subpaths directly (`import nextCoreWebVitals from "eslint-config-next/core-web-vitals"`)
   instead of going through `FlatCompat` at all.

With both resolved, `npm run lint` surfaced **26 real findings** on its first-ever run against
this codebase (17 errors, 9 warnings) — genuinely fixed, not suppressed wholesale:

- 6 `react/no-unescaped-entities` (literal `'`/`"` in JSX text) — trivial, safe entity-escape fixes.
- 2 genuinely-unused imports (`eq` in `tests/engagementCheck.test.ts`, `RunOptions` in
  `tests/materialAggregator.test.ts`) — removed.
- 1 real `@typescript-eslint/no-explicit-any` in `src/orchestrator/templates/registry.ts` — this
  one is a genuine, correct type-erasure boundary (a `Map` deliberately holding
  `PromptTemplate<X,Y>` for many incompatible `X`/`Y` pairs; `unknown` isn't assignable here
  because the type's input parameter is contravariant) — reviewed and left with a targeted,
  documented `eslint-disable-next-line`, not changed.
- 8 `react-hooks/set-state-in-effect` findings (`AudioPlayer` ×4, `CourseMindMap`,
  `DownloadsManager`, `ProgressStream`, `PushNotificationToggle`) — this specific rule flags ANY
  effect that calls `setState`, including well-established, correct React patterns (syncing to an
  external system on mount, resetting state when a prop changes before starting a new operation,
  triggering real media playback). Each was individually reviewed; all 8 are genuine, standard
  patterns — restructuring `AudioPlayer` in particular around this single strict rule would have
  meant reworking already-verified Phase 7.5/10 player logic well beyond what a lint pass
  warrants, which Phase 10's own kickoff explicitly warned against for this exact component. Each
  is a targeted, per-line `eslint-disable-next-line` with a specific one-line reason, not a
  blanket rule disable — the rule stays fully active for any new code going forward.
- The remaining warnings were the codebase's own pre-existing `_paramName` convention for an
  intentionally-unused parameter in a shared callback signature (used across many test mocks since
  Phase 4) — resolved with one targeted config addition
  (`argsIgnorePattern`/`varsIgnorePattern: "^_"`), not a blanket rule change, and documented in
  `eslint.config.mjs` itself as the one deliberate tweak beyond the Next.js default ruleset.

`npm run lint` now runs clean (0 errors, 0 warnings, exit code 0). No CI pipeline exists in this
repo to wire it into (no `.github/workflows/` or similar) — `lint`/`typecheck`/`test` are all
plain `npm run` scripts a human or a future CI setup can call directly.

### This README

The title changed from "Teacher — Orchestrator, Search, the Research Agent..." (Phase 1's original
working name and its own first-phase scope) to "Athena," and the intro now describes the finished
v1 system end to end instead of narrating through Phase 5's plumbing. A "Contents" section and a
"Current status" section were added at the top — a navigation aid and an honest summary of what's
real-verified vs. dry-run/mocked across all eleven phases, each point linking back to the specific
phase section that has the actual detailed record. Every phase's own documented decisions,
deviations, and gaps stay exactly as written underneath — this pass adds an index and fixes a
stale intro, it doesn't rewrite history.

### Real-device verification — attempted, still not possible here

Per this phase's own Deliverable 5, a real attempt was made to close Phase 10's four open items
(PWA installability, airplane-mode offline behavior, backgrounded-PWA audio, real push delivery to
a device) rather than silently re-documenting them as outstanding a third time. This environment
has no real phone, tablet, or any device beyond the sandboxed Windows machine this whole project
has been built on, and no teammate/friend's device was reachable from within it — so this remains
genuinely not possible here, stated plainly rather than re-asserted as done. What COULD be
verified instead (and was, in this same phase): the manifest and service worker serve correctly
over real HTTP, `error.tsx`/`not-found.tsx`/the redirect fix are confirmed via a real production
server, and the accessibility/lint passes are real, automated, and numerically evidenced above.

### Definition of done — Phase 11

- Loading/error/not-found boundaries exist and are demonstrated: a real thrown error and a real
  bad course/lesson id, verified via a real production build + server (`next build && next
  start`), not just file existence.
- Accessibility: a real `axe-core` pass against 7 real rendered pages, with a concrete before
  (1 violation) / after (0 violations) number, plus a documented list of what was manually fixed
  and what `jsdom`'s lack of real layout genuinely can't check (color contrast).
- `npm run lint` exists, runs clean, and every one of its first-run findings was either fixed for
  real or left with a specific, reviewed, documented reason (never a blanket suppression).
- This README's title and intro describe the finished v1 system, with a working Contents/status
  section — every phase's own historical content is intact underneath.
- Real-device verification was genuinely attempted and remains genuinely unavailable in this
  environment — stated plainly, not silently inherited from Phase 10 unexamined.
- All Phase 1-10 tests still pass (323/323); `npm run typecheck` clean on both configs after the
  TypeScript 6.0.3 downgrade, confirmed identical before and after.
- No new features, screens, agents, or data model changes anywhere in this phase's diff.

### Documented gaps

- **Real device verification remains closed** — see above. The single biggest remaining gap on
  this whole project, carried forward honestly rather than worked around.
- **Color contrast is unverified by automation** — `jsdom` can't measure real rendered contrast;
  this design system's dark-mode tokens (`app/globals.css`) were chosen for a "calm, low-distraction"
  feel, not explicitly audited against WCAG contrast ratios. Worth a real browser-based check.
- **No CI pipeline** — `lint`/`typecheck`/`test` are real, working, independent scripts, but
  nothing runs them automatically on push/PR in this repo yet.

## Source Diversity: PDF + Video Transcript Support (a scoped addition, not a numbered phase)

Agreed in a separate planning conversation, done after Phase 11 and before moving to full
real-API/real-device testing. The Research Agent's architecture was always meant to be extensible
beyond HTML articles — `Source.type` (`src/db/schema.ts`) always included `"pdf"` and `"video"`,
and `extraction/fetchAndClean.ts`'s `classifyNonHtmlContentType()` always detected them — but both
branches just returned an empty, zero-confidence result. This closes that gap for exactly two
source types: real PDF text extraction and real YouTube video transcripts. Podcasts, other video
platforms, images/OCR are deliberately out of scope — not "not built yet," genuinely not attempted.

### A real bug found and fixed: YouTube URLs were routed as HTML articles

`classifyNonHtmlContentType()` only ever branched on the HTTP `Content-Type` header. A YouTube
watch page's `Content-Type` is `text/html`, so every YouTube URL Tavily search surfaced — and it
surfaces them constantly — fell straight into the Readability/JSDOM article path and either
scraped garbage from the player page's chrome or came back empty, never reaching a transcript at
all. Fixed with a URL-*pattern* check, `isYoutubeVideoUrl()` (`extraction/fetchAndClean.ts`),
that runs before any HTTP request is even made — unlike PDF (which genuinely needs a real
round-trip first; there's no reliable URL-only signal for "this is a PDF"), a video URL never
needs its header sniffed. Recognized patterns: `youtube.com/watch`, `youtu.be/`, and
`youtube.com/shorts/` (which redirects into the same watch flow) — documented here as the
exhaustive list, not "at minimum" language inviting silent scope creep later.
`tests/extraction.test.ts` proves the fix directly: a mocked transcript adapter is asserted
called, and a `global.fetch` spy is asserted **never** called for a `youtube.com/watch` URL —
not just "the right sourceType came back," which a coincidentally-passing article extraction
could also produce.

### Deliverable 1: an optional, additive `locator` on every citation

`src/shared/locator.ts` defines `Locator = {type: "page", value: number} | {type: "timestamp",
value: string}` — a neutral, dependency-free type (alongside `ids.ts`, `recheckInterval.ts`,
`mastery.ts`) so `extraction/` (which has zero orchestrator dependency, by its own long-standing
design) and `orchestrator/templates/extractGroundedKeyPoints.ts` can both depend on the same shape
without either owning it. `ExtractGroundedKeyPointsOutputSchema`'s `keyPoints[]` gained an
`locator: LocatorSchema.optional()` field, `SourceExcerpt` gained a matching optional `locator`
(shown in each excerpt's header line, e.g. `... | page: 3 ---`), and the prompt now tells the
model to copy an excerpt's locator verbatim when it draws a point from it, never invent one.
`SourceRecord` (`research/types.ts`) gained an optional `chunks?: SourceChunk[]` (one chunk per
page/timestamp window, each with its own optional locator) and `maxLocatorValue?: number` (the
source's real known extent — total pages, or duration in seconds).

**The grounding hard gate did not relax.** `createCitationValidator`'s source_id check
(`research/grounding.ts`) is untouched, still the only thing that can trigger a retry — a locator
is metadata on top of an already-valid citation, never a new pass/fail condition synthesis is
scored against. Locator correctness gets its own function, `checkLocatorSanity`, a **soft**,
log-only check: it warns when a cited page number exceeds a source's real known page count, or a
cited timestamp exceeds a video's real known duration, and never returns anything the retry loop
reads. `tests/grounding.test.ts` proves both halves: five new pure tests exercise
`checkLocatorSanity` directly (real bound respected → silent; fabricated bound → one `console.warn`,
never a thrown error or a failure result), while every pre-existing grounding test — including the
two that drive a real retry loop through `orchestrator.run()` — passes completely unmodified.

### Deliverable 2: real PDF extraction (`pdf-parse` v2)

`src/extraction/fetchAndCleanPdf.ts`'s `parsePdf()` wraps `pdf-parse`'s real v2 `PDFParse` class
API (the current major version — the class-based API, not v1's bare-function one). Before writing
any integration code, the actual installed package's `.d.ts` files were read directly to confirm
the real shape, and then verified further: a byte-accurate, valid, real 2-page PDF was hand-built
(computing its xref table offsets programmatically, not hand-typed) and parsed for a real smoke
test, confirming `new PDFParse({data}).getText()` returns `{pages: [{num, text}], text, total}`
and that `getText({partial: [n]})` genuinely filters to one page. `getText()` with no filter
already returns every page's text plus the real total page count in one call, so `parsePdf()`
only ever needs that one call (`getText({partial})` per page was unnecessary). **Chunking
granularity: one chunk per real page**, not grouped page ranges — the documents this project
researches (papers, reports) are short enough that per-page is already a reasonable prompt-sized
unit, and it's the PDF's own natural structural boundary, unlike video captions (see below). A
scanned/image-only PDF is real, reachable, valid PDF bytes that `pdf-parse` (no OCR — genuinely
not attempted, per scope) parses down to near-empty text per page; it's run through the exact same
length-based confidence heuristic (`MIN_USABLE_TEXT_LENGTH`/`CONFIDENT_TEXT_LENGTH`) a thin HTML
article already uses, degrading to `emptyResult("pdf")` — logged, excluded, never a crash. Every
PDF-path test (`tests/extraction.test.ts`, `tests/fetchAndCleanPdf.test.ts`) mocks `PDFParse`/
`parsePdf` — no real PDF is fetched or parsed in the test suite.

### Deliverable 3: real YouTube transcript retrieval (`@sinco-lab/mcp-youtube-transcript`)

`src/mcp/youtubeTranscript.ts` mirrors `mcp/webSearch.ts`'s `SearchProvider` pattern exactly:
a `TranscriptProvider` interface, a `YoutubeTranscriptMCPProvider` class (same
`client`/`connecting`/`ensureConnectedSafe`/`connect` shape), a module singleton, and a bare
`getTranscript()` export — launched the same way Tavily's MCP server is, `npx -y <package>` over
stdio, and **not** added as a `package.json` dependency, matching the existing convention
(`tavily-mcp` isn't one either; `npx` fetches/caches it on demand). No API key needed for either
new dependency. Rather than trust the kickoff's own description of the tool, the real published
package was downloaded (`npm pack`) and its compiled source read directly — this is what revealed
the correct tool is `get_timed_transcript` (not the more obviously-named `get_transcripts`, which
returns non-timestamped prose), returning one text block (`"# {title}\n\n[HH:MM:SS.mmm]
caption\n..."`) plus a `_meta.totalDuration` in seconds, parsed by regex rather than assumed to be
JSON.

**Caption chunking: grouped into ~3-minute windows, not one chunk per raw caption line.** A real
transcript's raw lines are only a few seconds apart — a hand-typed first draft mapped each raw
line directly to a chunk, which would fan out into hundreds of tiny `SourceExcerpt`s (mostly
per-excerpt header overhead around a few words of real caption) for any real video longer than a
few minutes; caught and fixed before shipping. `youtubeTranscript.ts`'s `groupIntoWindows()`
concatenates consecutive raw caption lines into fixed 180-second windows (a judgment call,
documented here rather than left implicit), each window's `text` the joined captions and its
`timestamp` its first real caption's own timestamp — keeping a video's chunk count in the same
rough ballpark as a PDF's page count. `TranscriptResult.segments` still preserves real timestamped
structure (never flattened to one blob of prose) — grouped, not discarded. A captionless/private/
age-restricted video degrades to `null` (logged, not thrown); `fetchAndClean.ts`'s
`fetchAndCleanVideo` treats that the same as `emptyResult("video")`. `tests/youtubeTranscript.test.ts`
mocks the MCP client and covers the real response parsing, the windowing behavior specifically
(a dedicated test with raw lines placed to land in three different windows), the fallback total-
duration computation, and every failure path — no real MCP server is ever launched in the test
suite.

No dedicated "search YouTube" retrieval path was built — Tavily's existing search already surfaces
YouTube URLs organically (confirmed by this phase's own dry-run and by how often Tavily results
already needed the URL-routing fix above). If real topics turn out to rarely surface video results
in practice, a dedicated video-oriented query variant is a natural, cheap follow-up — noted, not
built speculatively now.

### Material Aggregator: confirmed unmodified, exactly as scoped

`materialAggregator/index.ts` was read, not edited. Its `countValid()` only counts
`type === "article"` sources for the below-threshold/backfill trigger — unrelated, pre-existing,
unchanged behavior — while `insertSource()` persists **any** `cleaned.sourceType` unconditionally.
A PDF/video source is therefore already correctly persisted as a real `sources` DB row with zero
code changes here; it simply doesn't count toward the "valid sources per lesson" threshold, same
as before this phase existed. Verified directly (see Definition of done below), not just reasoned
about.

### What was verified real vs. mocked

- **Real, live-verified**: `pdf-parse` v2's actual API shape (read from installed `.d.ts` files)
  and its actual parsing behavior (a hand-built, byte-accurate real PDF, parsed for a real smoke
  test, both cleaned up afterward). `@sinco-lab/mcp-youtube-transcript`'s actual published,
  compiled source (`npm pack` + extraction, read directly, cleaned up afterward) — confirming the
  real tool name and real response text/metadata shape.
- **Dry-run-seeded, not live**: same situation as every other phase in this README —
  `TAVILY_API_KEY` has never been set in this environment (see "Current status" above), so a
  genuinely real research run (a live Tavily search that happens to surface a real PDF and a real
  YouTube video) has never been exercised. Instead, `npm run harness -- research --dry-run` and
  `build --dry-run` were extended (`src/harness/mocks.ts`'s new
  `createMockFetchAndCleanWithSourceDiversity`, layered on top of the existing canned mock wiring,
  deterministic regardless of topic) to make two of the pipeline's canned mock-source URLs
  resolve as a real-shaped chunked PDF and a real-shaped chunked video instead of a plain article.
  Running `research --dry-run` produced a subtopic whose `sources[]` includes a real `chunks`
  array (two page-locator chunks, `maxLocatorValue: 2`) and whose `keyPoints[]` include entries
  citing it with a real `locator: {type: "page", value: 1}` / `{type: "page", value: 2}`, plus a
  second source with three timestamp-locator chunks and matching `{type: "timestamp", value:
  "4:32"}`-style key points — inspected directly from the written `output/*.dry-run.json`, not
  asserted from memory. Running `build --dry-run` (which additionally runs Course Builder +
  Material Aggregator, both real code, against an isolated `data/teacher.dry-run.db`) was then
  queried directly (`node:sqlite`) and confirmed two real persisted `sources` rows with
  `type = 'pdf'` and `type = 'video'` and real, non-empty `extracted_text` — the actual DB-level
  proof, not an inference from the log line saying so. `knowledge-update --dry-run` deliberately
  keeps using the original, unmodified `mockFetchAndClean` — this phase's mock changes are
  additive to `research`/`build`, not something every dry-run entrypoint needed.

### Definition of done — Source Diversity

- [x] URL-routing bug fixed and proven by a real unit test (mocked transcript adapter called;
      a `global.fetch` spy asserted never called for a YouTube URL), not just a passing sourceType
      assertion.
- [x] Real PDF text extraction, with per-page chunks/locators, backed by a real, verified
      `pdf-parse` v2 integration; scanned/image-only PDFs degrade to excluded/low-confidence, no
      OCR added.
- [x] Real YouTube transcript retrieval via a verified MCP tool call, with captions grouped into
      real, reasonably-sized (~3 min) timestamped chunks rather than one excerpt per raw line.
- [x] `locator` is optional and additive everywhere it appears; `createCitationValidator`'s
      source_id check is untouched and still the only hard grounding gate — proven by the full,
      unmodified pre-existing `tests/grounding.test.ts` suite passing, plus new tests for the new
      soft `checkLocatorSanity` check and its non-blocking behavior.
- [x] Material Aggregator required zero code changes — confirmed by reading its code (the
      `countValid()`/`insertSource()` distinction) and then confirmed for real: a `build --dry-run`
      persisted real `sources` rows with `type = 'pdf'`/`type = 'video'`, queried directly from
      the resulting SQLite file.
- [x] A dry-run-seeded research run demonstrably produced a subtopic with a real chunked PDF
      source and a key point citing `locator: {type: "page", ...}`, and a real chunked video
      source with a key point citing `locator: {type: "timestamp", ...}` — inspected directly from
      the written course JSON.
- [x] All existing tests pass unmodified where the scope required it (`tests/grounding.test.ts`,
      `tests/materialAggregator.test.ts`); new tests added for PDF extraction/confidence scoring,
      the transcript adapter's real response parsing and its caption-windowing behavior, the
      URL-routing fix, and optional-locator schema/soft-check handling. Full suite: 347/347
      passing. `npm run typecheck` clean on both configs; `npm run lint` clean.
- [x] No changes to Course Builder, Material Aggregator's persistence logic, the Memory Graph,
      Quiz/Practice Engines, the Goal Planner, the Continuous Learning/Knowledge Update Agents, or
      any frontend screen. The only files touched outside `src/research/`/`src/extraction/`/the
      one new MCP adapter (`src/mcp/youtubeTranscript.ts`) are `src/shared/locator.ts` (a small,
      neutral shared type, same convention as this directory's existing files) and
      `src/harness/mocks.ts`/`src/harness/cli.ts` (the dry-run demonstration harness itself,
      needed to seed the DoD's real-run demonstration given no live `TAVILY_API_KEY`).

### Documented gaps

- **No real, live (non-dry-run) research run** — same root cause as every other phase: no
  `TAVILY_API_KEY` in this environment. The dry-run-seeded demonstration above is real code
  exercising a real chunking/locator/persistence path end to end; only the search results
  themselves are canned rather than a live Tavily response that happens to surface a PDF/video.
- **No dedicated video-oriented search query variant** — noted as a candidate follow-up above,
  not built now, since it wasn't yet clear real topics need it.
- **Podcasts, other video platforms, images/OCR remain fully out of scope** — not partially built,
  not stubbed, genuinely untouched, exactly as scoped.

## Pre-Real-Testing Gap Fixes (a scoped addition, not a numbered phase)

A direct code-and-call-graph audit done right before moving to full real-API/real-device testing
found four real gaps — completing or connecting work that already existed, not new features.

### Gap 1: the Goal Planner's on-demand generation never called generateMindMap

`app/api/courses/build-stream/route.ts` (the standalone `/new` topic flow) already ran
`generateMindMap()` as a 4th step after research → build → aggregate (Phase 8). `generateTopicCourse()`
(`src/pathPlanner/index.ts`) — the function every Goal/Path-generated course goes through, reached
via `/paths/[id]`'s "generate this topic" action — never did, so any course reached through a Path
(the PRD's own primary example, "become a full-stack quant," is a goal, not a single topic)
silently never got a mind map. Fixed by adding a `generateMindMapFn` option to
`generateTopicCourse()` (same optional-injection shape as its existing `runResearchPipelineFn`/
`buildCourseFn`/`aggregateMaterialsFn`) and calling it as a 4th step in the exact same
degrade-on-failure way (`try`/`catch`, logged via `onProgress`, never fails the course generation)
`build-stream/route.ts` already established — mirrored, not reinvented. Both real call sites —
`build-stream/route.ts` and `app/api/paths/[id]/topics/[topicId]/generate-stream/route.ts` — needed
**zero** route changes, since both are thin wrappers that already just call their respective
research/build chain function directly; the fix lives entirely inside `generateTopicCourse()`
itself. The harness's `goal` command needed no separate wiring either: it already forwards a
generic `onProgress` into `generateTopicCourse()` without printing its own per-step headers, so the
mind map step's own progress lines ("Generating mind map for...", "Persisted mind map: N node(s),
M edge(s).") now surface there automatically, for free.

### Gap 2: a citation's locator never survived past the Research Agent's in-memory CourseJson

The Source Diversity phase's per-key-point `locator` (page/timestamp) existed only in the
in-memory `CourseJson`/`SubtopicResult.keyPoints` — `lessons.sourceRefs` (`src/db/schema.ts`) was a
bare `string[]` of source ids, and `materialAggregator/index.ts`'s `aggregateMaterials()` (not
`courseBuilder/index.ts`, which correctly leaves `sourceRefs: []` at initial insert time by design
— see "Source linking is the Material Aggregator's job" in that file's own doc comment) wrote it as
`persisted.map((p) => p.id)`, discarding every locator. `SourceCitations.tsx` never rendered one.
The entire payoff of the Source Diversity work — a citation that says *where* (page 4, 12:34), not
just *that* — never reached the UI.

- **Schema**: `lessons.sourceRefs` is now `LessonSourceRefEntry[]` (`{sourceId: string, locator?:
  Locator}[]`), not `string[]`. Only the Drizzle-level `.$type<>()` annotation changed — the
  underlying SQL column is still `text` in `{mode: "json"}` (the same situation Phase 7.5's
  `AudioCacheEntry[]` retype hit) — confirmed via a real `npm run db:generate`, which produced
  `No schema changes, nothing to migrate 😴`. No migration file exists for this change because none
  was needed, not because one was skipped.
- **Where it's populated**: `materialAggregator/index.ts`'s new `buildSourceRefEntries(persisted,
  keyPoints)` — every persisted source gets one bare `{sourceId}` entry (identical to today's
  behavior) UNLESS a real key point cited it with a real locator, in which case that source gets
  one entry per DISTINCT locator instead (a locator is strictly more specific than "this lesson
  used this source," so it replaces the bare entry rather than sitting alongside it). Two key
  points citing the exact same `(source_id, locator)` pair collapse to one entry; two different
  locators on the same source are kept as two separate entries — the source-diversity kickoff's
  own resolved default for exactly this case.
- **Where it's shown**: `SourceCitations.tsx` renders `(pdf, page 4, credibility 0.75)` /
  `(video, 12:34, credibility 0.70)` when a locator is present, and the original `(article,
  credibility 0.82)` unchanged when it isn't. The list `key` now includes the locator (not just the
  source id), since the same source can legitimately appear more than once.
- **Every reader normalized**: `db/schema.ts`'s new `normalizeSourceRefEntry()` maps a raw
  `sourceRefs` array entry to `{sourceId, locator?}` regardless of whether it's the new object
  shape or a pre-existing row's old bare id string — every reader (`db/queries.ts`'s
  `getCourseDetail()`/`getLessonWithSources()`, `teachingEngine/answerLessonQuestion.ts`, the
  course download bundle route) runs entries through it before use. This is reading old data the
  way it was actually written, not backfilling a locator that was never captured for it — per the
  kickoff's own resolved default, nothing attempts to backfill old rows.
- **`LessonSourceRef`** (`db/queries.ts`, the joined read shape `SourceCitations.tsx` consumes)
  gained an optional `locator` field; joining now fans out one output row per `sourceRefs` entry
  (not deduped by source id), so two distinct locators on the same source render as two separate
  citations, matching how they're stored.
- **The offline download bundle** (`app/api/courses/[id]/download/route.ts`,
  `lib/offline/types.ts`) deliberately keeps its `sourceRefs: string[]` shape unchanged — nothing in
  the offline viewer renders a locator today, so the route just extracts and dedupes ids before
  assigning; not a "new screen," not touched beyond that one line, per this addition's own scope
  boundary.

### Gap 3: `GRAPHITI_MCP_URL` was undocumented in `.env.example`

`src/memoryGraph/graphitiClient.ts` reads `process.env.GRAPHITI_MCP_URL` (defaulting to
`http://localhost:8000/mcp/`) and it was already correctly documented in this README's
"Environment variables" table — but never listed in `.env.example` itself, the one file someone
standing up their first real Docker/Graphiti instance (this project's own #1 stated outstanding
item) would actually copy and fill in. Added, with a comment pointing at "Setting up the Memory
Graph (Docker)" above rather than duplicating those instructions.

### Gap 4: two non-breaking dependency vulnerabilities

`npm audit` reported 6 findings (1 high: `fast-uri`, host-confusion/SSRF; 2 moderate: `qs`,
DoS/array-limit bypass; the rest, `esbuild` via `drizzle-kit`). Ran `npm audit fix` (not
`--force`) — a lockfile-only patch bump (`fast-uri` 3.1.5→3.1.7, `qs` 6.15.3→6.16.0, no
`package.json` change, confirmed via `git diff`) resolved `fast-uri` and `qs` completely.
`typecheck`/`lint`/`test`/`build` all confirmed clean afterward. The remaining `esbuild` finding
(`GHSA-67mh-4wv8-2f99`, moderate — a vulnerable dev-server-only `esbuild` transitively required by
`drizzle-kit`'s `@esbuild-kit/esm-loader`) is **accepted, not force-fixed**: it's a local
`drizzle-kit` tooling risk (never present in the shipped app, which never runs `esbuild`'s dev
server), and `npm audit fix --force` would downgrade `drizzle-kit` to `0.18.1` — a real breaking
change to migration tooling, not worth the risk this close to real testing for a risk that isn't
in the shipped app at all.

### An incidental discovery while verifying Gap 1+2 together: `pdf-parse` broke `next dev`

Not one of the four audited gaps, but a real, load-bearing bug found DURING this addition's own
verification (see Definition of done below) and fixed on the spot since it would have blocked the
very next-testing-phase this whole addition exists to unblock: `next.config.ts`'s
`serverExternalPackages` already lists `jsdom` and `@modelcontextprotocol/sdk` specifically because
webpack can't cleanly bundle a "large, non-trivial-to-bundle" package into the RSC graph — the
Source Diversity phase added `pdf-parse` as a new dependency (`extraction/fetchAndCleanPdf.ts`)
without adding it to this same list. The result: `next dev --webpack` crashed with `TypeError:
Object.defineProperty called on non-object` while bundling `fetchAndCleanPdf.ts` for **any** page
that transitively imports it — including `/`, the Dashboard, via `knowledgeUpdate/index.ts` →
`extraction/fetchAndClean.ts` — a 500 on the homepage in dev mode. Confirmed this was dev-bundling-
specific, not a real production bug: `npm run build && npm run start` never hit it (`/` correctly
307-redirected to `/onboarding` on a fresh DB). Fixed by adding `"pdf-parse"` to
`serverExternalPackages` (now `["@modelcontextprotocol/sdk", "jsdom", "pdf-parse"]`) — confirmed
`next dev` serves the same page cleanly (a real 200, no error trace) afterward.

### Definition of done — Pre-Real-Testing Gap Fixes

**Real, live-confirmed against a real running server, not dry-run-claimed-only**:

- **Ran a single scripted, real (not interactive-CLI) call through `decomposeAndPersistPath` →
  `runOverlapDetectionForPath` → `generateTopicCourse`** — real code, the exact function chain
  `/paths/[id]` drives, using the same mocked LLM/search/fetch machinery
  (`src/harness/mocks.ts`'s `createMockOrchestratorRun`/`createMockFetchAndCleanWithSourceDiversity`)
  every other dry-run demonstration in this README already uses (no real `TAVILY_API_KEY` in this
  environment — same root cause as every prior phase). Produced a real PathTopic-generated course
  with real modules/lessons, and — the actual point of Gap 1 — a real, queried-directly `mindMaps`
  row whose node ids are a genuine subset of that course's real lesson ids.
- **Confirmed Gap 2's locator threading against the SAME course's real persisted `lessons` row**:
  its `source_refs` column genuinely contains `[{"sourceId":"src_mock_5","locator":{"type":"page",
  "value":1}}, {"sourceId":"src_mock_5","locator":{"type":"page","value":2}}, {"sourceId":
  "src_mock_6","locator":{"type":"timestamp","value":"0:00"}}, ...]` — queried directly via
  `node:sqlite`, not asserted from a unit test alone — real, distinct locators stored as real,
  distinct entries, exactly as designed.
- **Then started a real production server (`npm run build && npm run start`) against that same
  database and fetched `/courses/<that real course id>` over real HTTP** — the raw, real
  server-rendered HTML genuinely contains `(pdf, page 1, credibility 0.85)` and `(video, 4:32,
  credibility 0.85)` inside the actual `SourceCitations` markup, confirmed by locating that exact
  text in the response body, not by trusting the component's logic alone. This is the DoD's
  "rendered HTML, not just a passing test" bar, for a course reached through the goal-path flow
  specifically (not just standalone `/new`).
- **The incidental `pdf-parse`/`next dev` fix, confirmed the same way**: reproduced the crash on
  `/courses/[id]` under `next dev --webpack` before the fix (`GET ... 500`, `Object.defineProperty
  called on non-object`), confirmed the fix (`GET ... 200`, no error) after adding `pdf-parse` to
  `serverExternalPackages`, on a real running dev server.
- **Backward compatibility, unit-tested directly**: a lesson whose `sourceRefs` is still the OLD
  bare-string-array shape (constructed by deliberately bypassing the now-updated insert type, the
  same way earlier phases construct hard-to-naturally-produce real fixtures) reads back correctly
  as a locator-less citation, with no crash, through both `getLessonWithSources()` and
  `getCourseDetail()` — the Course view's own read path.
- `npm audit` shows only the documented, accepted `esbuild`/`drizzle-kit` finding remaining.
  `.env.example` includes `GRAPHITI_MCP_URL`.
- All existing tests pass; new tests added for `generateTopicCourse`'s mind map step (mocked, same
  injection pattern as its other three steps, plus a degrade-on-failure case), the migrated
  `sourceRefs` shape's real read/write round-trip (including two distinct locators on the same
  source, and an exact-repeat collapsing to one entry), and old-shape backward-compatible reads in
  both `getLessonWithSources()` and `getCourseDetail()`. Full suite: 356/356 passing.
  `npm run typecheck` clean (both configs), `npm run lint` clean, `npm run build` succeeds.
- No changes to Course Builder's own lesson-insert logic (still correctly leaves `sourceRefs: []`
  at insert time — verified this stays true, not modified), the Memory Graph, Quiz/Practice
  Engines, or any new screen/agent/data-model beyond `LessonSourceRefEntry` itself.

### Documented gaps

- **No real, live (non-dry-run/non-mocked) goal-path generation** — same root cause as every prior
  phase: no `TAVILY_API_KEY` in this environment. The scripted demonstration above is real code
  (`generateTopicCourse`, `generateMindMap`, the full locator-threading path) exercising a real
  DB write/read/render round trip; only the search results themselves are canned.
- **The mind map's interactive React Flow canvas itself remains unverified in a real browser** —
  the same honest gap Phase 8 already documented (no browser automation tooling in this
  environment); this addition only closes the "does a goal-path course even GET a mind map row"
  gap, not Phase 8's own pre-existing rendering-verification gap.

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

### Phase 1 + 2

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
- [x] `npm run typecheck` clean; all 82 tests pass (`npm test`).
- [ ] **A real run against a genuinely non-trivial topic, with at least one subtopic that failed
      its first depth audit and passed on retry, demonstrated in the report.** Still open — see
      "The real-run blocker" below. Progress since it was last written up: a real Gemini API key
      is now configured, and a real (non-mocked) run *did* get further than before — subtopic 1 of
      a real "Special Relativity" decomposition genuinely passed its depth audit with real Tavily
      search results and real extracted article text — before hitting a real quota wall rather
      than a code bug.

### Phase 3

- [x] Course Builder (`sequence_modules` + `write_lesson_metadata`, both routed through the
      Orchestrator) and Material Aggregator built and unit-tested — see `tests/courseBuilder.test.ts`,
      `tests/courseBuilderTemplates.test.ts`, `tests/materialAggregator.test.ts`.
- [x] Modules/lessons are correctly sequenced respecting prerequisite order — **demonstrated**
      (not just claimed) via `tests/courseBuilder.test.ts` and a constructed `--dry-run` case
      below, both using a genuine dependency edge the model declares out of declaration order.
- [x] The backfill path is demonstrated (a constructed case, per the spec's "real or constructed"
      wording for this item) — log excerpt below, plus `tests/materialAggregator.test.ts` covering
      both the recovery and still-below-threshold-after-backfill outcomes with mocked failures.
- [x] The Memory Graph stub existed (`src/memoryGraph/index.ts`), was called from `buildCourse()`
      right after persistence, and logged a `Phase 3.5` TODO on every call — not silently missing.
      **Now superseded**: Phase 3.5 replaced this stub with a real implementation — see below.
- [x] No mind map generation, no quiz/practice logic, no frontend.
- [x] All Phase 1 and 2 tests still pass; new tests cover sequencing/prerequisite-order logic,
      Source persistence and lesson-linking, and the backfill trigger (mocked failing-source case,
      no real API/search calls in CI).
- [x] `npm run typecheck` clean.
- [ ] **A real run against a genuinely non-trivial topic producing persisted Course/Module/Lesson/
      Source records in SQLite, inspectable via `npm run inspect`.** Blocked by the same real-run
      issue as Phase 2's open item — see "The real-run blocker" below. Every other Phase 3
      Definition-of-done item is independently satisfied via unit tests and a `--dry-run` demo.

### Phase 3.5

- [x] `docker compose up` **documented** in README (Setup, above), referencing getzep/graphiti's
      official pre-built image directly. **Not run** — see "The Docker verification gap" below;
      this environment has no Docker installed, so this item is unverified, not confirmed working.
- [ ] A real `npm run harness -- build "some topic"` run writing topic/prerequisite nodes/edges and
      per-subtopic facts to the graph, verified with `inspect-graph`. **Not done** — needs both a
      real LLM run (blocked, see "The real-run blocker") *and* a running Graphiti service (blocked,
      see "The Docker verification gap"). Wiring is unit-tested (`tests/memoryGraph.test.ts`) and
      the call sites are in place (`buildCourse()` → `writeTopic()`, `aggregateMaterials()` →
      `writeSubtopicFacts()`), but neither has executed against a real graph.
- [x] Phase 3's stub is fully replaced — `grep -rn "TODO: Phase 3.5" src/ tests/` returns no matches.
- [x] Unit tests mock the MCP client (no Docker needed in CI): `writeTopic`'s call shape,
      `writeSubtopicFacts`'s call shape, and graceful degradation on a simulated connection
      failure for both — `tests/memoryGraph.test.ts`.
- [x] All Phase 1–3 tests still pass (82/82, `npm test`).
- [x] `npm run typecheck` clean.
- [x] README updated: Docker Compose setup, FalkorDB choice and why, new env vars, `inspect-graph`
      usage, and the confirmed Streamable HTTP transport (read from graphiti's own source — see
      "The Memory Graph" above).

### Prerequisite-order demonstration (dry run + unit test)

`npm run harness -- build --dry-run "Special Relativity"`'s mock deliberately returns modules out
of dependency order — `sequence_modules` responds with `[m3, m1, m2]` in that array order, but
declares `m1` a prerequisite of `m3`. `courseBuilder`'s code-side `topoSortModules()` (not the
model's own array order) decides the real persisted order, confirmed via `npm run inspect`:

```
Module [0] mod_mock-module-m1_bf84b9 — "Mock Module (m1)"
    prerequisite_of: mod_mock-module-m3_bf84b9
    Lesson lsn_mock-lesson-mock-subtopic-one_bf84b9 — "Mock Lesson: Mock Subtopic One" ...

Module [1] mod_mock-module-m3_bf84b9 — "Mock Module (m3)"
    Lesson lsn_mock-lesson-mock-subtopic-three_bf84b9 — "Mock Lesson: Mock Subtopic Three" ...

Module [2] mod_mock-module-m2_bf84b9 — "Mock Module (m2)"
    Lesson lsn_mock-lesson-mock-subtopic-two_bf84b9 — "Mock Lesson: Mock Subtopic Two" ...
```

`m1` (order `0`) precedes `m3` (order `1`) despite `m3` being declared first — the persisted order
is a genuine permutation of the model's declared order, not an echo of it.
`tests/courseBuilder.test.ts` asserts the same thing directly against an in-memory db.

### Backfill demonstration (dry run + unit test)

The same `build --dry-run` run forces "Mock Subtopic Two"'s four re-fetched sources to come back
`"unreachable"` (a deliberately constructed case, documented in `src/harness/mocks.ts`), producing
this real log excerpt:

```
[build-harness] Aggregating materials for "Mock Subtopic Two"...
[build-harness]   https://example.com/mock-source-9 re-fetched as "unreachable" — not counted as a valid source.
[build-harness]   https://example.com/mock-source-10 re-fetched as "unreachable" — not counted as a valid source.
[build-harness]   https://example.com/mock-source-11 re-fetched as "unreachable" — not counted as a valid source.
[build-harness]   https://example.com/mock-source-12 re-fetched as "unreachable" — not counted as a valid source.
[build-harness]   "Mock Subtopic Two" has 0 valid source(s) (< 2) — triggering one targeted backfill.
[build-harness]   backfill for "Mock Subtopic Two" found 2 additional source(s).
```

`tests/materialAggregator.test.ts` covers both outcomes the spec's "one attempt, then ship
flagged" policy requires: recovering above threshold (asserts `backfillSubtopic` is called
exactly once, with the real gap description in its input) and staying below threshold after the
one attempt (asserts `source_status: "below_threshold"` and that backfill is *not* retried a
second time).

### The real-run blocker (Phase 2, Phase 3, and now Phase 5 — same cause)

Both phases' remaining open items need the same thing: a full, real (non-mocked) pipeline run.
That's now blocked by something more specific than "no API key configured" — a real
`GEMINI_API_KEY` **is** configured, and multiple real runs were attempted this session. The
blocker is Gemini's free-tier quota: `generativelanguage.googleapis.com/generate_content_free_tier_requests`
allows **20 requests/day per project per model**. A real run against a genuinely non-trivial topic
needs far more than that — `runResearchPipeline()` alone issues roughly 6 LLM calls per subtopic
per research pass (`generate_search_queries`, `extract_grounded_key_points`,
`generate_contention_queries`, `synthesize_subtopic`, `restructure_layers`, `depth_audit_score`),
times however many subtopics `decompose_topic` returns (6, for "Special Relativity" — a real,
observed decomposition this session), times up to `maxAuditRetries + 1` passes per subtopic that
fails its audit — comfortably 40-100+ calls for one course, before Course Builder's 2 more calls
or Material Aggregator's backfill calls. This isn't a timing problem that a later retry fixes; it's
a capacity problem the free tier can't cover for a topic with more than one or two subtopics,
confirmed live: a real "Special Relativity" run got through subtopic 1's full research pass (with
real Tavily search and real extracted article text) and into subtopic 2 before hitting
`RESOURCE_EXHAUSTED` with `limit: 20, model: gemini-3.6-flash`.

Options to actually close these two items out, in rough order of preference:

1. **Enable billing on the Gemini API key** (moves off the free tier's 20/day cap) and re-run
   `npm run harness -- build "<a real, non-trivial topic>"`.
2. **Switch to Anthropic** (`LLM_PROVIDER=anthropic` + a real `ANTHROPIC_API_KEY` in `.env`) for
   one real run, since the Orchestrator is provider-agnostic by design — nothing else changes.
3. **Spread a single run across multiple days**, relying on each model's quota resetting daily —
   slow and awkward, not recommended.

Once one real run succeeds, closing both items is the same manual check described previously:
inspect the resulting course (via `output/<slug>.json` for Phase 2's audit-retry evidence, and
`npm run inspect -- <course_id>` for Phase 3's persisted-record evidence).

**Phase 5 hit the identical wall the same day.** Unlike Phase 2/3's own blocked items, most of
Phase 5's `[LLM]` steps (classification, decomposition, cross-domain dependency mapping, the
overlap detection's `quick_refresh_check`) need NO web search at all — only on-demand generation
does (it's the exact same `runResearchPipeline` call Phase 2/3 use). Real classification calls
succeeded (see "Definition of done — Phase 5" for the actual output — both a clear single-topic
and a clear broad-goal input, real reasoning), but the very next real call
(`decompose_goal_into_path`, attempted right after) hit `RESOURCE_EXHAUSTED` — confirmed the daily
cap was genuinely exhausted (not a transient hiccup) by immediately retrying a single, minimal
`classify_topic_or_goal` call afterward, which failed the same way. This tracks: Phase 4's own real
run in this same session (quiz/practice generation, scoring, critique, two full practice attempts)
already spent a substantial share of the day's 20-request cap before Phase 5 even started. See
"Definition of done — Phase 5" for exactly what real evidence exists vs. what's covered by the
(extensive, deterministic) unit test suite instead.

### The Docker verification gap (Phase 3.5)

**This environment has no Docker installed** — `docker`/`docker compose` are not on `PATH`, and no
Docker Desktop install was found in the usual locations. This is a harder blocker than Phase 2/3's
quota issue: it's not that a real run got partway before hitting a wall, it's that **nothing in
Phase 3.5 has been run against a live Graphiti server at all**. Concretely, this means the
following are reasoned from reading `getzep/graphiti`'s actual source (not guessed from memory —
see "The Memory Graph" above for what was specifically verified: transport, tool names/signatures,
config schema, response shapes) but **not confirmed by actually running them**:

- That `docker compose up` in `mcp_server/` actually brings up a healthy service with this exact
  compose file and config — the file references a real published image and real upstream config
  keys, but has never been pulled or started.
- That `src/memoryGraph/graphitiClient.ts`'s `StreamableHTTPClientTransport` usage actually
  connects and completes the MCP handshake against a real server, not just a mocked one.
- That `GraphitiMCPClient.callTool()`'s defensive `structuredContent`-then-`content[0].text`
  parsing matches what the real server actually returns for this MCP SDK/server version pairing.
- That `mcp_server/config.yaml`'s Gemini provider config for both `llm` and `embedder` is accepted
  and produces real entity/fact extraction from a real episode.

None of this changes what's verifiable without Docker, which is everything unit-testable: the
client's call shapes, argument construction, response parsing logic, and graceful-degradation
behavior are all covered by `tests/memoryGraph.test.ts` against a mocked MCP client, and typecheck
+ the full test suite are clean. **To close this out**: install Docker Desktop (or run this on a
machine that has it), `cd mcp_server && docker compose up -d`, confirm `curl localhost:8000/health`
responds, then run `npm run harness -- build "<a real, non-trivial topic>"` (this also needs the
real-run blocker above resolved first, since `build` needs real LLM calls too) followed by
`npm run inspect-graph -- "<that topic>"` to confirm nodes/edges/facts actually landed.

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
- **Database driver is `node:sqlite`, not `better-sqlite3`** — the PRD offered `better-sqlite3` as
  "a reasonable pick," not a requirement, and it needs a native binding compiled via `node-gyp`;
  this environment has no C++ build toolchain (no Visual Studio Build Tools) and the installed
  version ships no prebuilt binary fallback. Node's own built-in `node:sqlite` (stable since
  Node 22) needs no compilation and is wired into Drizzle's generic `sqlite-proxy` driver instead
  — see "The database layer" above. The schema, query builder, and migration workflow are
  unaffected; only `src/db/client.ts` would need to change to switch back if a future environment
  has a working toolchain and prefers `better-sqlite3`'s (mildly faster) native binding.
- **Memory Graph backend is FalkorDB, not Neo4j** — the PRD names Neo4j, but this was an explicit,
  requested deviation (not something arrived at independently): FalkorDB is `getzep/graphiti`'s own
  Docker Compose quickstart default, and one combined FalkorDB+MCP-server container is meaningfully
  lighter to run on a single personal machine than a separate JVM-based Neo4j service alongside it.
  Neo4j stays a documented fallback — graphiti's own repo ships a `docker-compose-neo4j.yml`
  alongside the FalkorDB one, and `mcp_server/config.yaml`'s `database.providers.neo4j` block is
  already present (just not selected) — so switching later is a config change, not new code.
- **Graphiti's own internal LLM/embedder provider is Gemini, not OpenAI** — upstream's own default
  config uses OpenAI for both; `mcp_server/config.yaml` overrides both to `"gemini"` so Graphiti's
  entity/fact extraction reuses the same Google AI Studio key Teacher's own Orchestrator already
  defaults to, rather than requiring a second, unrelated OpenAI key just for this one service's
  internal bookkeeping. Not requested explicitly, but a natural extension of the already-adopted
  "default to Gemini" decision — documented here rather than left implicit in a config file.
- **(Phase 4) `topic_type` is classified by the Practice Engine itself, not "set by the Research
  Agent"** — the PRD's literal spec assumes Phase 2's Research Agent already tags this; the actual
  Phase 2 build doesn't. Rather than retrofitting an already-verified earlier phase for a field only
  Phase 4 uses, `classify_topic_type` is Phase 4's own first step. See "Deviation: topic_type is
  classified by the Practice Engine, not the Research Agent" above.
- **(Phase 4) `concept_node_id` defaults to `lesson_id`, coarser than the PRD's eventual
  Mind-Map-defined granularity** — Phase 8 (Mind Map Agent) doesn't exist yet to define finer nodes.
  A module-scoped `PracticeAttempt`'s `experienceScore` update is broadcast to every lesson under
  that module rather than being tracked at a finer grain. See "concept_node_id granularity
  (documented simplification)" above for the full reasoning and its one real consequence.
- **(Phase 5) `Path`/`PathDomain`/`PathTopic` is an original schema design, not a literal PRD
  table** — Section 7's data model has no Path entity despite section 5.12a requiring one
  persisted. Filled the gap in the spirit of the prompt's own sketch, with two of my own added
  design decisions (a topological-tier `order` shared with `parallel_group`, and tier-gated rather
  than raw-edge-gated topic selection). See "The Path data model (a documented gap, not a literal
  PRD table)" above for the full writeup and reasoning.
- **(Phase 5) `runResearchPipeline()` gained one additive `goalContext?: string` option** rather
  than the Research Agent being rewritten — threaded into exactly `decompose_topic` and
  `synthesize_subtopic`'s prompts as extra framing, absent (and therefore a complete no-op) for
  every standalone Phase 1-4 call. This is exactly the scope the kickoff prompt asked for ("a
  small, additive change... not a rewrite"); see "Deviation: goalContext is a small additive
  Research Agent option, not a rewrite" above.
