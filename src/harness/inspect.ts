#!/usr/bin/env node
import "dotenv/config";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { courses, modules, lessons, sources, quizResults, practiceAttempts, masteryState } from "../db/schema.js";

/**
 * Dumps a persisted course's structure from SQLite — modules in persisted
 * order, each with its lessons, source counts, and source_status flags.
 * There's no UI yet, so this is how `npm run harness -- build "<topic>"`
 * output actually gets verified.
 */
async function main(): Promise<void> {
  const courseId = process.argv.slice(2).find((a) => a !== "--dry-run");
  const dryRun = process.argv.includes("--dry-run");

  if (!courseId) {
    console.error("Usage: npm run inspect -- [--dry-run] <course_id>");
    process.exitCode = 1;
    return;
  }

  const db = dryRun ? await getDb(path.join(process.cwd(), "data", "teacher.dry-run.db")) : await getDb();

  const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
  if (!course) {
    console.error(`No course found with id "${courseId}"${dryRun ? " in data/teacher.dry-run.db" : ""}.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nCourse: ${course.id}`);
  console.log(`  topic: ${course.topic}`);
  console.log(`  status: ${course.status}`);
  console.log(`  volatility_tier: ${course.volatilityTier}`);
  console.log(`  created_at: ${course.createdAt}`);

  const courseModules = await db
    .select()
    .from(modules)
    .where(eq(modules.courseId, courseId))
    .orderBy(modules.order);

  let totalLessons = 0;
  let totalSources = 0;
  let belowThreshold = 0;

  for (const mod of courseModules) {
    console.log(`\n  Module [${mod.order}] ${mod.id} — "${mod.title}"`);
    console.log(`    ${mod.description}`);
    if (mod.prerequisiteOf.length > 0) {
      console.log(`    prerequisite_of: ${mod.prerequisiteOf.join(", ")}`);
    }

    const moduleLessons = await db.select().from(lessons).where(eq(lessons.moduleId, mod.id));
    for (const lesson of moduleLessons) {
      totalLessons += 1;
      totalSources += lesson.sourceRefs.length;
      if (lesson.sourceStatus === "below_threshold") belowThreshold += 1;
      console.log(
        `    Lesson ${lesson.id} — "${lesson.title}" (${lesson.estimatedDuration}) — ${lesson.sourceRefs.length} source(s)${
          lesson.sourceStatus === "below_threshold" ? " [BELOW_THRESHOLD]" : ""
        }`
      );

      const lessonQuizResults = await db.select().from(quizResults).where(eq(quizResults.lessonId, lesson.id));
      for (const qr of lessonQuizResults) {
        console.log(`      QuizResult ${qr.id} — tier: ${qr.tier}, score: ${qr.score.toFixed(2)}, date: ${qr.date}`);
      }

      const [mastery] = await db.select().from(masteryState).where(eq(masteryState.conceptNodeId, lesson.id));
      if (mastery) {
        console.log(
          `      MasteryState (concept_node_id: ${mastery.conceptNodeId}) — knowledge_score: ` +
            `${mastery.knowledgeScore ?? "(none yet)"}, experience_score: ${mastery.experienceScore ?? "(none yet)"}, ` +
            `last_updated: ${mastery.lastUpdated}`
        );
      }
    }

    const modulePracticeAttempts = await db
      .select()
      .from(practiceAttempts)
      .where(eq(practiceAttempts.moduleId, mod.id));
    for (const pa of modulePracticeAttempts) {
      console.log(
        `    PracticeAttempt ${pa.id} — type: ${pa.type}, attempt #${pa.attemptNumber}, date: ${pa.date}`
      );
      console.log(`      feedback: ${pa.feedback}`);
      if (pa.reflectionNotes) console.log(`      reflection_notes: ${pa.reflectionNotes}`);
    }
  }

  const allSourceRows = await db.select().from(sources);

  console.log(
    `\nTotals: ${courseModules.length} module(s), ${totalLessons} lesson(s), ${totalSources} lesson-source link(s), ${belowThreshold} lesson(s) below_threshold.`
  );
  console.log(`Source table rows (this DB, all courses): ${allSourceRows.length}`);
}

main().catch((error) => {
  console.error("[inspect] Failed:", error);
  process.exitCode = 1;
});
