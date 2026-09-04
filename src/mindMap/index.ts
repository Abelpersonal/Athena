import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { run as orchestratorRun } from "../orchestrator/index.js";
import {
  createGenerateMindMapValidator,
  type GenerateMindMapOutput,
  type GenerateMindMapLessonRef,
} from "../orchestrator/templates/generateMindMap.js";
import { getDb, type TeacherDb } from "../db/client.js";
import { courses, modules, lessons, mindMaps, type MindMapGraph } from "../db/schema.js";
import { writeMindMapNodes as writeMindMapNodesDefault } from "../memoryGraph/index.js";

export type OrchestratorRunFn = typeof orchestratorRun;
export type ProgressListener = (message: string) => void;
export type WriteMindMapNodesFn = typeof writeMindMapNodesDefault;

export class MindMapError extends Error {}

export interface GenerateMindMapOptions {
  /** Injectable for tests. Default: the real orchestrator.run(). */
  orchestratorRun?: OrchestratorRunFn;
  /** Injectable for tests. Default: getDb() (real, migrated SQLite at data/teacher.db). */
  db?: TeacherDb;
  /** Injectable for tests. Default: the real memoryGraph.writeMindMapNodes(). */
  writeMindMapNodes?: WriteMindMapNodesFn;
  onProgress?: ProgressListener;
}

export interface GenerateMindMapResult {
  courseId: string;
  graph: MindMapGraph;
}

/**
 * The Mind Map Agent (Phase 8, PRD §5.12): [LLM] one-shot call converting a finalized course
 * structure into a node/edge graph -> [code] validate node/edge ids against the course's real
 * lessons -> [code] persist (DB + Memory Graph) -> output consumed directly by the React Flow
 * frontend (components/CourseMindMap.tsx via src/db/queries.ts's getCourseMindMap). Node STATE
 * (not started/in progress/mastered) is deliberately NOT computed or stored here — that's read-time
 * work against `masteryState`, per the PRD's own step 5, so a mind map never goes stale just
 * because mastery changed.
 *
 * Called from app/api/courses/build-stream/route.ts and the harness's `build` command as a 4th
 * step after aggregateMaterials() — NOT from src/courseBuilder/index.ts itself, matching how
 * Phase 3's own kickoff prompt kept "triggers Material Aggregator + Mind Map Agent" out of that
 * module. A failure here degrades (logged, course generation still completes) — this is an
 * enrichment step, not a precondition for a course existing, same policy the Memory Graph writes
 * already follow.
 */
export async function generateMindMap(
  courseId: string,
  options: GenerateMindMapOptions = {}
): Promise<GenerateMindMapResult> {
  const run = options.orchestratorRun ?? orchestratorRun;
  const db = options.db ?? (await getDb());
  const writeMindMapNodesFn = options.writeMindMapNodes ?? writeMindMapNodesDefault;
  const onProgress = options.onProgress;

  const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
  if (!course) throw new MindMapError(`No course found with id "${courseId}".`);

  const courseModules = await db.select().from(modules).where(eq(modules.courseId, courseId));
  const lessonRefs: GenerateMindMapLessonRef[] = [];
  for (const m of courseModules) {
    const moduleLessons = await db.select().from(lessons).where(eq(lessons.moduleId, m.id));
    for (const l of moduleLessons) {
      lessonRefs.push({ lessonId: l.id, title: l.title, description: l.description, moduleTitle: m.title });
    }
  }
  if (lessonRefs.length === 0) {
    throw new MindMapError(`Course "${courseId}" has no lessons yet — cannot generate a mind map.`);
  }
  const knownLessonIds = new Set(lessonRefs.map((l) => l.lessonId));

  onProgress?.(`Generating mind map for "${course.topic}" (${lessonRefs.length} lesson(s))...`);
  const result = await run<GenerateMindMapOutput>(
    "generate_mind_map",
    { courseTopic: course.topic, lessons: lessonRefs },
    "mind-map-agent",
    { validateExtra: createGenerateMindMapValidator(knownLessonIds) }
  );

  const graph: MindMapGraph = {
    nodes: result.data.nodes.map((n) => ({ id: n.lessonId, conceptLabel: n.conceptLabel })),
    edges: result.data.edges,
  };

  const now = new Date().toISOString();
  await db
    .insert(mindMaps)
    .values({ id: `mm_${randomUUID()}`, courseId, graphJson: graph, createdAt: now })
    .onConflictDoUpdate({ target: mindMaps.courseId, set: { graphJson: graph, createdAt: now } });

  onProgress?.(`Persisted mind map: ${graph.nodes.length} node(s), ${graph.edges.length} edge(s).`);

  await writeMindMapNodesFn(courseId, course.topic, graph.nodes, graph.edges);

  return { courseId, graph };
}
