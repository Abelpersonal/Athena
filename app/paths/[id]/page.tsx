import Link from "next/link";
import { notFound } from "next/navigation";
import { loadPathRoadmap, isTopicGeneratable } from "../../../src/pathPlanner/index.js";
import { getPathMeta } from "../../../src/db/queries.js";
import { GenerateTopicButton } from "../../../components/GenerateTopicButton.js";
import { DownloadPathButton } from "../../../components/DownloadPathButton.js";

const STATUS_LABEL: Record<string, string> = {
  pending: "Not started",
  linked_existing: "Already covered (linked to an existing course)",
  delta_needed: "Mostly covered — a targeted delta is needed for this goal's angle",
  in_progress: "Generating…",
  mastered: "Mastered",
};

/**
 * The Path view — syllabus-of-syllabi. Server Component reusing loadPathRoadmap() and
 * isTopicGeneratable() directly from src/pathPlanner/index.ts (Phase 5), unchanged. Topics within
 * a tier are presented as a "these can happen in any order" group rather than exposing raw
 * order/parallelGroup values — the advanced-detail-one-tap-away principle applies to the internal
 * scheduling mechanics, not to the status itself, which is the actual overlap-detection decision
 * and is always shown directly. (The per-topic natural-language reasoning behind that decision is
 * a Phase 5 runtime log line only, never persisted to the DB — showing it here would need a schema
 * change this phase's scope boundary rules out; the status labels below are the closest honest
 * substitute, not a fabrication of the original reasoning text.)
 */
export default async function PathViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [path, roadmap] = await Promise.all([getPathMeta(id), loadPathRoadmap(id)]);
  if (!path) notFound();

  const domains = [...new Set(roadmap.map((t) => t.domainName))];
  const downloadableCourseIds = [...new Set(roadmap.map((t) => t.courseId).filter((id): id is string => id !== null))];

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-xl font-medium">{path.goalDescription}</h1>
        <p className="text-sm text-[var(--color-text-muted)]">{path.status}</p>
        <DownloadPathButton courseIds={downloadableCourseIds} />
      </div>

      {domains.map((domainName) => {
        const domainTopics = roadmap.filter((t) => t.domainName === domainName);
        const tiers = [...new Set(domainTopics.map((t) => t.order))].sort((a, b) => a - b);

        return (
          <section key={domainName}>
            <h2 className="text-lg font-medium mb-3">{domainName}</h2>
            {tiers.map((tier) => (
              <div key={tier} className="mb-3">
                {tiers.length > 1 && (
                  <p className="text-xs text-[var(--color-text-faint)] mb-1">
                    Group {tier + 1} — these can happen in any order
                  </p>
                )}
                <ul className="space-y-2">
                  {domainTopics
                    .filter((t) => t.order === tier)
                    .map((t) => (
                      <li key={t.id} className="rounded-lg border border-[var(--color-border)] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            {t.courseId ? (
                              <Link href={`/courses/${t.courseId}`} className="hover:text-[var(--color-accent)]">
                                {t.topicName}
                              </Link>
                            ) : (
                              <span>{t.topicName}</span>
                            )}
                            <p className="text-sm text-[var(--color-text-faint)]">{STATUS_LABEL[t.status] ?? t.status}</p>
                          </div>
                          {isTopicGeneratable(t, roadmap) && (
                            <GenerateTopicButton pathId={id} topicId={t.id} topicName={t.topicName} />
                          )}
                        </div>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
