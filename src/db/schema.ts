import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";
import type { RestructureLayersOutput } from "../orchestrator/templates/restructureLayers.js";

/**
 * Phase 3's slice of the PRD's data model (Section 7). QuizResult,
 * PracticeAttempt, MasteryState, Book, and UpdateEvent belong to later
 * phases and are deliberately not modeled here yet.
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
