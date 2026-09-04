import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";
import type { RestructureLayersOutput } from "../orchestrator/templates/restructureLayers.js";

/**
 * Phase 3's slice of the PRD's data model (Section 7), plus Phase 4's
 * QuizResult / PracticeAttempt / MasteryState, Phase 5's Path / PathDomain /
 * PathTopic, and Phase 6's Book / UpdateEvent (the PRD's last two deferred
 * tables) plus LessonUpdate (an original addition — see README, "'Update
 * lesson' storage").
 */

export const courses = sqliteTable("courses", {
  id: text("id").primaryKey(),
  topic: text("topic").notNull(),
  createdAt: text("created_at").notNull(),
  /** Aggregated from subtopic-level volatility (Phase 2): "mixed" when subtopics disagree. */
  volatilityTier: text("volatility_tier", { enum: ["fast", "medium", "slow", "mixed"] }).notNull(),
  /** "building" until the Material Aggregator finishes linking sources; "complete" after. */
  status: text("status", { enum: ["building", "complete"] }).notNull().default("building"),
  /**
   * Phase 5: the goal/domain framing this course was researched under, when it was generated
   * on-demand from a Path (see runResearchPipeline's additive `goalContext` option) — null for a
   * course built standalone (every Phase 1-4 call site) or as a plain "linked" match. Overlap
   * detection reads this back to tell "generic fundamentals" (null) apart from "mastered under a
   * DIFFERENT goal's angle" (a different non-null value) — see src/pathPlanner/overlap.ts.
   */
  goalContext: text("goal_context"),
  /**
   * Phase 6: when the LEARNER finished this course (every lesson has a QuizResult across all
   * three tiers — see quizEngine.checkAndMarkCourseCompletion), not when content-generation
   * finished. Deliberately a SEPARATE column from `status` above: `status` ("building"/"complete")
   * is Phase 3's content-pipeline signal (has the Material Aggregator finished linking sources?) —
   * a completely different concept from "did the learner actually finish it," and conflating the
   * two would break every existing `status: "complete"` check across Phases 3-5. Null until the
   * completion trigger fires; this is what the Continuous Learning Agent gates on.
   */
  completedAt: text("completed_at"),
  /**
   * Phase 6: last time the Knowledge Update Agent checked this course for staleness — null means
   * "never checked" (always due). Compared against getRecheckIntervalDays(volatilityTier)
   * (src/shared/recheckInterval.ts) to select due topics.
   */
  lastChecked: text("last_checked"),
});

export const modules = sqliteTable("modules", {
  id: text("id").primaryKey(),
  courseId: text("course_id")
    .notNull()
    .references(() => courses.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  /** Column named order_index (not "order") to sidestep the SQL reserved word; the JS-facing field stays "order" per the PRD's data model. */
  order: integer("order_index").notNull(),
  /** Module ids that this module is a prerequisite of (i.e. depend on it) — derived from sequence_modules + a code-side topological sort, not trusted verbatim from the model. */
  prerequisiteOf: text("prerequisite_of", { mode: "json" }).$type<string[]>().notNull(),
});

export type CourseLessonLayers = RestructureLayersOutput["layers"];

/**
 * Phase 7.5: one cached audio chunk's record. `layer`/`chunkIndex` locate it within
 * chunkLessonAudio()'s output (src/teachingEngine/chunkLessonAudio.ts) — deliberately NOT
 * importing `LessonLayerKey` from there to avoid a schema.ts <-> teachingEngine circular import;
 * this literal union is structurally identical and TypeScript treats them as compatible.
 * `contentHash` is the actual cache key (a hash of the chunk's text) — `layer`/`chunkIndex` locate
 * the entry, but a text change (e.g. Phase 6's Knowledge Update Agent regenerating a layer)
 * naturally produces a different hash, so a stale entry is detected by hash mismatch rather than
 * needing explicit invalidation coupling between the two phases.
 */
export interface AudioCacheEntry {
  layer: "intuition" | "mechanics" | "formal" | "application" | "frontier";
  chunkIndex: number;
  contentHash: string;
  filePath: string;
}

export const lessons = sqliteTable("lessons", {
  id: text("id").primaryKey(),
  moduleId: text("module_id")
    .notNull()
    .references(() => modules.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  estimatedDuration: text("estimated_duration").notNull(),
  layers: text("layers", { mode: "json" }).$type<CourseLessonLayers>().notNull(),
  sourceRefs: text("source_refs", { mode: "json" }).$type<string[]>().notNull(),
  /**
   * Phase 7.5: per-chunk audio cache index — an array of AudioCacheEntry, not a single ref,
   * since layers reveal progressively in the UI (Phase 7's "one tap away" principle) and a
   * collapsed layer's chunks must never be force-generated together with the rest. Still the
   * SAME text column reserved since Phase 3 ("column exists now so the schema doesn't need to
   * change later") — only the Drizzle-level type annotation changed (JSON mode), not the
   * underlying SQL column type, so this needed no migration (confirmed via `db:generate`).
   */
  audioCacheRef: text("audio_cache_ref", { mode: "json" }).$type<AudioCacheEntry[]>(),
  /** "below_threshold" when a lesson still has fewer than the minimum valid sources after one backfill attempt — shipped anyway, flagged rather than blocked. */
  sourceStatus: text("source_status", { enum: ["ok", "below_threshold"] })
    .notNull()
    .default("ok"),
});

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  /** "unreachable" and "low_confidence" are real fetch/extraction outcomes, not a fabricated paywall detector — see README. */
  type: text("type", { enum: ["article", "pdf", "video", "other", "unreachable", "low_confidence"] }).notNull(),
  extractedText: text("extracted_text").notNull(),
  credibilityScore: real("credibility_score").notNull(),
  fetchedAt: text("fetched_at").notNull(),
});

/**
 * Phase 4: the Quiz/Assessment Engine's persisted results. One row per
 * (lesson, tier) tested in a quiz session — a session covering all three
 * tiers writes three rows, not one. `score` is 0-1 continuous for both
 * objective (multiple-choice, scored 0 or 1 in code) and free-text
 * (semantically graded by the Orchestrator) questions — see
 * src/quizEngine/README notes for the full scoring writeup.
 */
export const quizResults = sqliteTable("quiz_results", {
  id: text("id").primaryKey(),
  lessonId: text("lesson_id")
    .notNull()
    .references(() => lessons.id),
  tier: text("tier", { enum: ["recall", "application", "transfer"] }).notNull(),
  score: real("score").notNull(),
  date: text("date").notNull(),
});

/**
 * Phase 4: the Practice/Experience Engine's persisted attempts. Scoped to
 * module_id (not lesson_id) per the PRD's data model — a practice attempt
 * exercises a whole module's worth of content, unlike a quiz which targets
 * one lesson.
 */
export const practiceAttempts = sqliteTable("practice_attempts", {
  id: text("id").primaryKey(),
  moduleId: text("module_id")
    .notNull()
    .references(() => modules.id),
  type: text("type", { enum: ["project", "simulation", "debate"] }).notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  feedback: text("feedback").notNull(),
  reflectionNotes: text("reflection_notes"),
  date: text("date").notNull(),
});

/**
 * Phase 4: the queryable current-state mastery table — "what's this
 * concept's score right now," a simple keyed read, as opposed to the Memory
 * Graph's dated-fact history of how it got there (see memoryGraph.writeMasteryUpdate).
 *
 * concept_node_id granularity: the Mind Map Agent (Phase 8) will eventually
 * define finer-grained concept nodes; until it exists, concept_node_id
 * defaults to lesson_id everywhere — coarser than the PRD's eventual intent,
 * but consistent and upgradable later without a data migration. A practice
 * attempt is scoped to a module (see practiceAttempts above), so its
 * experience_score update is broadcast to every lesson_id under that module
 * — see practiceEngine's README notes.
 *
 * knowledgeScore and experienceScore are updated independently: a quiz run
 * only ever writes knowledgeScore (via onConflictDoUpdate targeting just
 * that column), a practice run only ever writes experienceScore, and either
 * can be null until its respective engine has run at least once for this
 * concept node.
 */
export const masteryState = sqliteTable("mastery_state", {
  conceptNodeId: text("concept_node_id").primaryKey(),
  knowledgeScore: real("knowledge_score"),
  experienceScore: real("experience_score"),
  lastUpdated: text("last_updated").notNull(),
});

/**
 * Phase 5: Path/PathDomain/PathTopic — the Goal Planner's own data model. The
 * PRD's Section 7 table has no Path entity even though section 5.12a requires
 * persisting one, so this is an original design filling that gap (not a
 * literal PRD table) — documented in full in the README under "The Path data
 * model (a documented gap, not a literal PRD table)".
 */
export const paths = sqliteTable("paths", {
  id: text("id").primaryKey(),
  goalDescription: text("goal_description").notNull(),
  createdAt: text("created_at").notNull(),
  status: text("status", { enum: ["active", "completed"] }).notNull().default("active"),
});

/** A skill domain within a goal (e.g. "Math", "Programming", "Finance" for "become a full-stack quant"). */
export const pathDomains = sqliteTable("path_domains", {
  id: text("id").primaryKey(),
  pathId: text("path_id")
    .notNull()
    .references(() => paths.id),
  name: text("name").notNull(),
  /** Domains are just presentational grouping/display order here — the real cross-domain scheduling constraint lives on pathTopics.order/parallelGroup, not on domain order. */
  order: integer("order_index").notNull(),
});

export const pathTopics = sqliteTable("path_topics", {
  id: text("id").primaryKey(),
  pathId: text("path_id")
    .notNull()
    .references(() => paths.id),
  domainId: text("domain_id")
    .notNull()
    .references(() => pathDomains.id),
  topicName: text("topic_name").notNull(),
  description: text("description").notNull(),
  /**
   * A topological TIER across the WHOLE path's cross-domain dependency graph (0 = no
   * prerequisites within the path, 1 = depends only on tier-0 topics, etc.) — computed by
   * src/pathPlanner/ordering.ts's computeCrossDomainOrder(), never trusted directly from the
   * model. Topic selection (Deliverable 4) gates on this: a topic can be generated once every
   * topic at a strictly lower tier is done, regardless of which domain it's in.
   */
  order: integer("order_index").notNull(),
  /** Topics sharing this value are mutually order-free (no dependency edge between them) — in this design, every topic at the same `order` tier shares one parallelGroup, so the two fields move together; parallelGroup exists as its own column because "which topics form one freely-orderable batch" is the more useful thing for a UI/CLI to group by, even though it's currently derived 1:1 from order. */
  parallelGroup: text("parallel_group").notNull(),
  /** Null until a course is generated for (or matched to) this topic. */
  courseId: text("course_id").references(() => courses.id),
  status: text("status", { enum: ["pending", "linked_existing", "delta_needed", "in_progress", "mastered"] })
    .notNull()
    .default("pending"),
});

/**
 * Phase 6: the Continuous Learning Agent's book recommendations. `relatedTopicId` references
 * `courses.id`, not a standalone "Topic" entity — the PRD's data model has no persisted Topic
 * table (Phase 5 hit the same gap for Path; see "The Path data model" in the README), and a
 * completed course is the real anchor a recommendation is generated FROM, whether that course was
 * built standalone or via a Path. `category`/`openLibraryWorkId`/`gutenbergUrl` are additive beyond
 * the PRD's literal 5 columns (id/title/author/related_topic_id/status) — `category` is the
 * core/optional_deep_dive/primary_source ranking the PRD's own step asks for, and the two id/url
 * fields are the verified-availability EVIDENCE that makes a suggestion real rather than a
 * hallucinated title (see generateBookRecommendations, src/continuousLearning/index.ts). `status`
 * transitions beyond "suggested" (reading/read) are defined per the PRD but not driven by any code
 * path yet — same "reserved, not assigned yet" status as PathTopic.status "mastered" (Phase 5).
 */
export const books = sqliteTable("books", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  author: text("author").notNull(),
  relatedTopicId: text("related_topic_id")
    .notNull()
    .references(() => courses.id),
  status: text("status", { enum: ["suggested", "reading", "read"] }).notNull().default("suggested"),
  category: text("category", { enum: ["core", "optional_deep_dive", "primary_source"] }).notNull(),
  /** Open Library work id (e.g. "OL12345W") — evidence a real, current edition was verified to exist. */
  openLibraryWorkId: text("open_library_work_id"),
  /** Set only when Gutenberg confirmed a legitimate free/open full text exists — null otherwise (most books). */
  gutenbergUrl: text("gutenberg_url"),
  createdAt: text("created_at").notNull(),
});

/**
 * Phase 6: the Knowledge Update Agent's detected deltas. `topicId` references `courses.id` (same
 * "Topic has no persisted entity" reasoning as `books.relatedTopicId` above). `severity` omits
 * "none" deliberately — a `compare_findings_to_facts` delta classified "none" means nothing
 * actually changed, so it's never persisted as an event at all (see
 * src/knowledgeUpdate/index.ts). `supersededFactRef` is the OLD Graphiti fact edge's uuid, when
 * one was identified — null for a delta that doesn't map to one specific prior fact.
 */
export const updateEvents = sqliteTable("update_events", {
  id: text("id").primaryKey(),
  topicId: text("topic_id")
    .notNull()
    .references(() => courses.id),
  detectedAt: text("detected_at").notNull(),
  severity: text("severity", { enum: ["minor", "moderate", "major"] }).notNull(),
  deltaSummary: text("delta_summary").notNull(),
  supersededFactRef: text("superseded_fact_ref"),
});

/**
 * Phase 6: a major-delta "update lesson" — a small DELTA ADDENDUM linked to the original Lesson
 * and the UpdateEvent that triggered it, per the PRD's resolved storage decision. The original
 * lesson's `layers` (src/db/schema.ts's `lessons` table) are never rewritten or touched; this is a
 * separate, additive record so the original stays intact as a historical record while the delta is
 * what's actually new. Deliberately lighter than the original lesson's five-layer structure (see
 * generate_update_lesson, src/orchestrator/templates/) — a full re-teach isn't the point here.
 */
export const lessonUpdates = sqliteTable("lesson_updates", {
  id: text("id").primaryKey(),
  lessonId: text("lesson_id")
    .notNull()
    .references(() => lessons.id),
  updateEventId: text("update_event_id")
    .notNull()
    .references(() => updateEvents.id),
  title: text("title").notNull(),
  whatChanged: text("what_changed").notNull(),
  updatedGuidance: text("updated_guidance").notNull(),
  createdAt: text("created_at").notNull(),
});

/**
 * Phase 8: the Mind Map Agent's output. The PRD's Section 7 table has no "Mind Map"/"Graph"
 * entity even though §5.5 clearly requires persisting one — the same gap Phase 5 hit for `Path`.
 * One JSON blob column, not normalized node/edge tables: the graph is small (one course's concept
 * nodes), regenerated wholesale on a rebuild (never incrementally patched in v1's static-once
 * model — PRD §5.5: "static per-course overview graph, generated once at course creation"), and
 * node STATE (not started/in progress/mastered) is computed at READ time from `masteryState`
 * (PRD step 5), never stored here — storing it redundantly would just be something to keep in
 * sync for no reason. Same deliberate v1 simplification as Phase 6's "don't persist Suggestion
 * records." `courseId` is unique — one static map per course.
 */
export interface MindMapNode {
  /** A real lessons.id — every node maps 1:1 to a real lesson, validated at generation time (src/orchestrator/templates/generateMindMap.ts). A genuine SUBSET of the course's lessons, not necessarily all of them. */
  id: string;
  /** The model's own concise concept framing — may differ from the lesson's full title; the real title/mastery/freshness are always joined in at read time via `id`, never trusted from the LLM. */
  conceptLabel: string;
}
export interface MindMapEdge {
  /** Both must be real node ids present in the SAME graph's `nodes` array — validated together, not just against the broader lesson id set, so the frontend never has to handle a dangling edge. */
  source: string;
  target: string;
  type: "prerequisite" | "cross_link";
}
export interface MindMapGraph {
  nodes: MindMapNode[];
  edges: MindMapEdge[];
}

export const mindMaps = sqliteTable("mind_maps", {
  id: text("id").primaryKey(),
  courseId: text("course_id")
    .notNull()
    .unique()
    .references(() => courses.id),
  graphJson: text("graph_json", { mode: "json" }).$type<MindMapGraph>().notNull(),
  createdAt: text("created_at").notNull(),
});
