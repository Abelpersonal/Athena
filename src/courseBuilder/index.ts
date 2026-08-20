import { randomBytes } from "node:crypto";
import { run as orchestratorRun } from "../orchestrator/index.js";
import {
  createSequenceModulesValidator,
  type SequenceModulesOutput,
  type SequenceModulesSubtopicRef,
} from "../orchestrator/templates/sequenceModules.js";
import {
  createWriteLessonMetadataValidator,
  type WriteLessonMetadataOutput,
} from "../orchestrator/templates/writeLessonMetadata.js";
import { topoSortModules } from "./sequence.js";
import { assignUniqueIds } from "../shared/ids.js";
import { getDb, type TeacherDb } from "../db/client.js";
import { courses, modules, lessons } from "../db/schema.js";
import { writeTopic as writeTopicToMemoryGraphDefault } from "../memoryGraph/index.js";
import type { CourseJson } from "../research/types.js";

export { CourseBuilderError } from "./sequence.js";

export type OrchestratorRunFn = typeof orchestratorRun;
export type ProgressListener = (message: string) => void;
export type WriteTopicFn = (courseId: string, topic: string, prerequisites: string[]) => Promise<void>;

export interface BuildCourseOptions {
  /** Injectable for tests and dry-run harness mode. Default: the real orchestrator.run(). */
  orchestratorRun?: OrchestratorRunFn;
  /** Injectable for tests. Default: getDb() (real, migrated SQLite at data/teacher.db). */
  db?: TeacherDb;
  /** Injectable for tests. Default: the real Memory Graph writeTopic() (Phase 3.5). */
  writeTopicToMemoryGraph?: WriteTopicFn;
  onProgress?: ProgressListener;
}

export interface BuildCourseResult {
  courseId: string;
  moduleCount: number;
  lessonCount: number;
  /** subtopic id -> persisted lesson id. The Material Aggregator needs this to link sources to the right lesson. */
  subtopicLessonMap: Record<string, string>;
}

function deriveCourseVolatility(course: CourseJson): "fast" | "medium" | "slow" | "mixed" {
  const tiers = new Set(course.subtopics.map((s) => s.volatility.tier));
  return tiers.size === 1 ? [...tiers][0]! : "mixed";
}

function randomSuffix(): string {
  return randomBytes(3).toString("hex");
}

/**
 * Phase 3's Course Builder: sequences Phase 2's research output into modules
 * and lessons respecting prerequisite order (both [LLM] steps route through
 * the Orchestrator, same as every prior phase), assembles the final
 * Course/Module/Lesson records, and persists them in one transaction. The
 * depth-audit checkpoint the PRD mentions for course finalization is
 * already satisfied by Phase 2's per-subtopic audit loop — not reimplemented
 * here. Source linking is the Material Aggregator's job (courseBuilder just
 * leaves sourceRefs empty and sourceStatus "ok" on every lesson it inserts).
 */
export async function buildCourse(course: CourseJson, options: BuildCourseOptions = {}): Promise<BuildCourseResult> {
  const run = options.orchestratorRun ?? orchestratorRun;
  const onProgress = options.onProgress;
  const writeTopicToMemoryGraph = options.writeTopicToMemoryGraph ?? writeTopicToMemoryGraphDefault;
  const db = options.db ?? (await getDb());

  const subtopicRefs: SequenceModulesSubtopicRef[] = course.subtopics.map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
  }));
  const subtopicIdSet = new Set(subtopicRefs.map((s) => s.id));
  const subtopicById = new Map(course.subtopics.map((s) => [s.id, s]));

  // Step 1 [LLM]: sequence subtopics into modules respecting prerequisite order.
  onProgress?.(`Sequencing ${subtopicRefs.length} subtopic(s) into modules...`);
  const sequenceResult = await run<SequenceModulesOutput>(
    "sequence_modules",
    { topic: course.topic, externalPrerequisites: course.prerequisites, subtopics: subtopicRefs },
    "course-builder",
    { validateExtra: createSequenceModulesValidator(subtopicIdSet) }
  );
  const orderedModules = topoSortModules(sequenceResult.data.modules);

  // Step 2 [LLM]: write module/lesson titles, short descriptions, estimated duration.
  onProgress?.("Writing module/lesson titles, descriptions, and durations...");
  const metadataResult = await run<WriteLessonMetadataOutput>(
    "write_lesson_metadata",
    {
      topic: course.topic,
      modules: orderedModules.map((m) => ({
        tempId: m.tempId,
        subtopics: m.subtopicIds.map((sid) => {
          const s = subtopicById.get(sid)!;
          return { id: s.id, title: s.title, description: s.description };
        }),
      })),
    },
    "course-builder",
    {
      validateExtra: createWriteLessonMetadataValidator(new Set(orderedModules.map((m) => m.tempId)), subtopicIdSet),
    }
  );
  const moduleMetaByTempId = new Map(metadataResult.data.modules.map((m) => [m.tempId, m]));
  const lessonMetaBySubtopicId = new Map(metadataResult.data.lessons.map((l) => [l.subtopicId, l]));

  // Step 3 [code]: assemble the final Course/Module/Lesson records. One random suffix is
  // shared across every id minted for this course-build, appended after each content slug —
  // otherwise two builds with similar-sounding module/lesson titles (e.g. re-running the same
  // topic, or the dry-run harness's fixed "Mock Module"/"Mock Lesson" titles) collide on a
  // UNIQUE constraint the second time, since assignUniqueIds only dedupes within one call.
  const runSuffix = randomSuffix();
  const courseId = `crs_${assignUniqueIds([course.topic], { fallback: "course" })[0]}_${runSuffix}`;
  const moduleIds = assignUniqueIds(
    orderedModules.map((m) => moduleMetaByTempId.get(m.tempId)?.title ?? m.tempId),
    { prefix: "mod_", fallback: "module" }
  ).map((id) => `${id}_${runSuffix}`);
  const tempIdToModuleId = new Map(orderedModules.map((m, i) => [m.tempId, moduleIds[i]!]));

  const allLessonTitles = orderedModules.flatMap((m) =>
    m.subtopicIds.map((sid) => lessonMetaBySubtopicId.get(sid)?.title ?? subtopicById.get(sid)!.title)
  );
  const allLessonIds = assignUniqueIds(allLessonTitles, { prefix: "lsn_", fallback: "lesson" }).map(
    (id) => `${id}_${runSuffix}`
  );

  const moduleRows: (typeof modules.$inferInsert)[] = [];
  const lessonRows: (typeof lessons.$inferInsert)[] = [];
  const subtopicLessonMap: Record<string, string> = {};

  let lessonCursor = 0;
  for (let i = 0; i < orderedModules.length; i++) {
    const m = orderedModules[i]!;
    const moduleId = tempIdToModuleId.get(m.tempId)!;
    const meta = moduleMetaByTempId.get(m.tempId);
    moduleRows.push({
      id: moduleId,
      courseId,
      title: meta?.title ?? m.tempId,
      description: meta?.description ?? "",
      order: i,
      prerequisiteOf: m.prerequisiteOfTempIds
        .map((t) => tempIdToModuleId.get(t))
        .filter((id): id is string => id !== undefined),
    });

    for (const subtopicId of m.subtopicIds) {
      const subtopic = subtopicById.get(subtopicId)!;
      const lessonMeta = lessonMetaBySubtopicId.get(subtopicId);
      const lessonId = allLessonIds[lessonCursor]!;
      lessonCursor += 1;
      lessonRows.push({
        id: lessonId,
        moduleId,
        title: lessonMeta?.title ?? subtopic.title,
        description: lessonMeta?.description ?? subtopic.description,
        estimatedDuration: lessonMeta?.estimatedDuration ?? "unknown",
        layers: subtopic.layers,
        sourceRefs: [],
        sourceStatus: "ok",
      });
      subtopicLessonMap[subtopicId] = lessonId;
    }
  }

  // Step 4 [code]: persist to the relational DB, all-or-nothing.
  onProgress?.(
    `Persisting course "${course.topic}" (${moduleRows.length} module(s), ${lessonRows.length} lesson(s))...`
  );
  await db.transaction(async (tx) => {
    await tx.insert(courses).values({
      id: courseId,
      topic: course.topic,
      createdAt: course.generatedAt,
      volatilityTier: deriveCourseVolatility(course),
      status: "building",
      goalContext: course.goalContext ?? null,
    });
    for (const row of moduleRows) await tx.insert(modules).values(row);
    for (const row of lessonRows) await tx.insert(lessons).values(row);
  });

  // Step 5 [code]: Memory Graph write — see src/memoryGraph/index.ts (Phase 3.5).
  await writeTopicToMemoryGraph(courseId, course.topic, course.prerequisites);

  // Step 6: output course_id.
  return { courseId, moduleCount: moduleRows.length, lessonCount: lessonRows.length, subtopicLessonMap };
}
