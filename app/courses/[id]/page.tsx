import Link from "next/link";
import { notFound } from "next/navigation";
import { getCourseDetail } from "../../../src/db/queries.js";
import { MasteryBadge } from "../../../components/MasteryBadge.js";
import { SourceCitations } from "../../../components/SourceCitations.js";

/**
 * The Course view — module/lesson list in persisted prerequisite order (modules.order), each
 * lesson's mastery state as a simple indicator. No mind map (Phase 8) — a plain list is correct
 * here per the Phase 7 scope boundary.
 */
export default async function CourseViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getCourseDetail(id);
  if (!detail) notFound();

  const { course, modules } = detail;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-medium">{course.topic}</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          {course.status === "complete" ? "Content ready" : "Still building"} · volatility: {course.volatilityTier}
          {course.completedAt && " · completed"}
        </p>
      </div>

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
