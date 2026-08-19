# Teacher — Orchestrator, Search, the Research Agent, Course Persistence, the Memory Graph, and Quiz/Practice Engines

Backend-first plumbing for a personal, single-user AI learning platform.

- **Phase 1** built the two things every later agent depends on: **the Orchestrator**
  (`src/orchestrator/`) — the single gateway every agent uses to call Claude — and **a web
  search adapter** (`src/mcp/`) — Tavily's MCP server behind a small interface.
- **Phase 2 + 2.5** build the **Research Agent** (`src/research/`) on top of Phase 1: a
  multi-pass pipeline that decomposes a topic, researches and synthesizes each subtopic with
  cited sources, self-audits its own depth and retries the subtopics that fall short, and tags
  the topic's volatility. Its output is a structured "course JSON" — subtopics with layered,
  cited content — ephemeral until Phase 3 persists it.
- **Phase 3** turns that ephemeral JSON into real, persisted course data: the **Course Builder**
  (`src/courseBuilder/`) sequences subtopics into modules and lessons respecting prerequisite
  order and writes `Course`/`Module`/`Lesson` records to SQLite; the **Material Aggregator**
  (`src/materialAggregator/`) re-fetches and permanently persists the sources cited during
  research, links them to their lesson, and triggers a targeted re-search when a lesson lands
  below the minimum valid-source count.
- **Phase 3.5** stands up the real **Memory Graph** — Graphiti on FalkorDB, run as a separate
  Docker service and reached over MCP (`src/memoryGraph/`) — and fills in Phase 3's stub exactly
  at its Course Builder call site, plus writes Phase 2's grounded key points as dated episodic
  facts once the Material Aggregator has persisted their real source ids.
- **Phase 4** builds the two modules that turn "content was generated" into "the user actually
  learned something": the **Quiz/Assessment Engine** (`src/quizEngine/`) generates tiered
  (recall/application/transfer) questions grounded in a lesson's own persisted content, captures
  answers via the CLI harness, scores objective questions in code and free-text answers
  semantically via the Orchestrator, and persists `QuizResult` rows. The **Practice/Experience
  Engine** (`src/practiceEngine/`) classifies a module's topic_type, selects and generates a
  practice format (project/simulation/debate — simulation and debate run as real multi-turn CLI
  dialogues), critiques the learner's actual output, and persists `PracticeAttempt` rows, with up
  to `DEFAULT_ESCALATION_CAP` (3) attempts auto-escalating in difficulty. Both engines write to
  the new `MasteryState` table — SQLite for queryable current state, and the Memory Graph for a
  dated history of how each concept node's score changed — see "Phase 4" below for the full
  writeup, including two documented deviations from the PRD's literal spec.

There is no Mind Map generation (Phase 8), Teaching Engine/voice (Phase 7.5), Continuous
Learning/Knowledge Update Agents (Phase 6), Goal/Career Path Planner (Phase 5), or frontend here
yet. **Important caveat, read before relying on the Definition-of-done checklists below:** this
environment has no Docker installed, so the Memory Graph's Docker Compose setup, live MCP writes,
and `inspect-graph` output could not be run or verified live here (Phase 3.5's gap, which also
applies to Phase 4's `MasteryState` Memory Graph mirroring) — see "The Docker verification gap"
near the end of this README before treating those items as confirmed. This environment also has
no `TAVILY_API_KEY` configured, so a real (non-mocked) `research`/`build` run — and therefore a
quiz/practice run grounded in genuinely-researched lesson content — could not be done either; see
"The real-run blocker" below for how Phase 4 worked around this for its own demonstration.

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
  db/                     # SQLite (node:sqlite) + Drizzle
    schema.ts                # courses / modules / lessons / sources / quizResults / practiceAttempts / masteryState (Phase 4) tables
    client.ts                  # getDb() — lazy connect + auto-migrate, sqlite-proxy driver
  shared/
    ids.ts                # slugify() / assignUniqueIds() — shared by pipeline.ts and courseBuilder
  harness/
    cli.ts               # debugging CLI: Phase 1 demo + `research [--dry-run]` + `build [--dry-run]` + `quiz` + `practice` (Phase 4)
    inspect.ts             # `npm run inspect -- <course_id>` — dumps a persisted course from SQLite, incl. QuizResult/PracticeAttempt/MasteryState (Phase 4)
    inspectGraph.ts          # `npm run inspect-graph -- "<topic>"` — dumps Memory Graph history
    mocks.ts              # canned dependencies for --dry-run (research AND build)
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

`src/db/schema.ts` defines Phase 3's four tables plus Phase 4's three — `Book` and `UpdateEvent`
belong to later phases and aren't modeled yet, so the schema grows incrementally instead of
drifting ahead of what's built:

| Table | Columns |
|---|---|
| `courses` | `id`, `topic`, `created_at`, `volatility_tier` (`fast`\|`medium`\|`slow`\|`mixed`, aggregated from subtopic tiers), `status` (`building`\|`complete`) |
| `modules` | `id`, `course_id`, `title`, `description`, `order` (DB column `order_index` — sidesteps the SQL reserved word, JS field stays `order`), `prerequisite_of` (JSON array of module ids) |
| `lessons` | `id`, `module_id`, `title`, `description`, `estimated_duration`, `layers` (JSON — same shape as Phase 2's `RestructureLayersOutput["layers"]`), `source_refs` (JSON array of source ids), `audio_cache_ref` (nullable, unused until the audio-caching phase — the column exists now so the schema doesn't change later), `source_status` (`ok`\|`below_threshold`) |
| `sources` | `id`, `url`, `type` (`article`\|`pdf`\|`video`\|`other`\|`unreachable`\|`low_confidence`), `extracted_text`, `credibility_score`, `fetched_at` |
| `quiz_results` (Phase 4) | `id`, `lesson_id`, `tier` (`recall`\|`application`\|`transfer`), `score` (0-1 real), `date` — one row per (lesson, tier) tested in a quiz session, not per question |
| `practice_attempts` (Phase 4) | `id`, `module_id`, `type` (`project`\|`simulation`\|`debate`), `attempt_number`, `feedback`, `reflection_notes` (nullable), `date` |
| `mastery_state` (Phase 4) | `concept_node_id` (primary key), `knowledge_score` (0-1 real, nullable), `experience_score` (0-1 real, nullable), `last_updated` — see "The Quiz/Assessment Engine" and "The Practice/Experience Engine" below for how the two score columns are kept independent |

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

### The real-run blocker (Phase 2 and Phase 3, shared cause)

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
