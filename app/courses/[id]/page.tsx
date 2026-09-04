import Link from "next/link";
import { notFound } from "next/navigation";
import { getCourseDetail, getCourseMindMap } from "../../../src/db/queries.js";
import { MasteryBadge } from "../../../components/MasteryBadge.js";
import { SourceCitations } from "../../../components/SourceCitations.js";
import { CourseMindMap } from "../../../components/CourseMindMap.js";
import { DownloadCourseButton } from "../../../components/DownloadCourseButton.js";

/**
 * The Course view — module/lesson list in persisted prerequisite order (modules.order), each
 * lesson's mastery state as a simple indicator, PLUS (Phase 8) the mind map graph when one
 * exists. The plain list is kept unconditionally — a reasonable fallback for a course whose
 * `mindMaps` row doesn't exist yet (e.g. one built before Phase 8 shipped, or where mind map
 * generation degraded during that course's build).
 */
export default async function CourseViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, mindMapData] = await Promise.all([getCourseDetail(id), getCourseMindMap(id)]);
  if (!detail) notFound();

  const { course, modules } = detail;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-xl font-medium">{course.topic}</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          {course.status === "complete" ? "Content ready" : "Still building"} · volatility: {course.volatilityTier}
          {course.completedAt && " · completed"}
        </p>
        <DownloadCourseButton courseId={course.id} />
      </div>

      {mindMapData.graph && (
        <section>
          <h2 className="text-lg font-medium mb-3">Concept map</h2>
          <CourseMindMap
            graph={mindMapData.graph}
            modules={modules.map((m) => ({
              id: m.id,
              title: m.title,
              order: m.order,
              lessons: m.lessons.map((l) => ({ id: l.id, knowledgeScore: l.knowledgeScore })),
            }))}
            updatedLessonIds={mindMapData.updatedLessonIds}
          />
        </section>
      )}

      {modules.map((m) => (
        <section key={m.id}>
          <h2 className="text-lg font-medium mb-1">{m.title}</h2>
          <p className="text-sm text-[var(--color-text-muted)] mb-3">{m.description}</p>
          <ul className="space-y-2">
            {m.lessons.map((l) => (
              <li key={l.id} className="rounded-lg border border-[var(--color-border)] p-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <Link href={`/lessons/${l.id}`} className="hover:text-[var(--color-accent)]">
                      {l.title}
                    </Link>
                    <p className="text-sm text-[var(--color-text-faint)]">{l.estimatedDuration}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <MasteryBadge knowledgeScore={l.knowledgeScore} />
                    <Link
                      href={`/quiz/${l.id}`}
                      className="text-sm px-2 py-1 rounded-md border border-[var(--color-border)] hover:border-[var(--color-accent)]"
                    >
                      Quiz
                    </Link>
                  </div>
                </div>
                <div className="mt-2">
                  <SourceCitations sources={l.sourceRefs} />
                </div>
              </li>
            ))}
          </ul>
          <Link
            href={`/practice/${m.id}`}
            className="inline-block mt-3 text-sm px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:border-[var(--color-accent)]"
          >
            Practice this module
          </Link>
        </section>
      ))}
    </div>
  );
}
