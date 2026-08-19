import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";
import type { RestructureLayersOutput } from "../orchestrator/templates/restructureLayers.js";

/**
 * Phase 3's slice of the PRD's data model (Section 7), plus Phase 4's
 * QuizResult / PracticeAttempt / MasteryState. Book and UpdateEvent belong
 * to later phases and are deliberately not modeled here yet.
 */

export const courses = sqliteTable("courses", {
  id: text("id").primaryKey(),
  topic: text("topic").notNull(),
  createdAt: text("created_at").notNull(),
  /** Aggregated from subtopic-level volatility (Phase 2): "mixed" when subtopics disagree. */
  volatilityTier: text("volatility_tier", { enum: ["fast", "medium", "slow", "mixed"] }).notNull(),
  /** "building" until the Material Aggregator finishes linking sources; "complete" after. */
  status: text("status", { enum: ["building", "complete"] }).notNull().default("building"),
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
  /** Not populated until the audio-caching phase; column exists now so the schema doesn't need to change later. */
  audioCacheRef: text("audio_cache_ref"),
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
