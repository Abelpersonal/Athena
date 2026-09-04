import Link from "next/link";
import { notFound } from "next/navigation";
import { getLessonWithSources } from "../../../src/db/queries.js";
import { LayerViewer } from "../../../components/LayerViewer.js";
import { SourceCitations } from "../../../components/SourceCitations.js";
import { LessonQA } from "../../../components/LessonQA.js";
import { PlaceholderPanel } from "../../../components/PlaceholderPanel.js";

/** The Lesson/Teaching screen — text-only in this phase (no audio player, Phase 7.5). */
export default async function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getLessonWithSources(id);
  if (!detail) notFound();

  const { lesson, courseId, courseTopic, sourceRefs } = detail;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/courses/${courseId}`} className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-accent)]">
          ← {courseTopic}
        </Link>
        <h1 className="text-xl font-medium mt-1">{lesson.title}</h1>
        <p className="text-sm text-[var(--color-text-muted)]">{lesson.description}</p>
      </div>

      <PlaceholderPanel label="Voice playback" note="Phase 7.5" />

      <LayerViewer layers={lesson.layers} />

      <SourceCitations sources={sourceRefs} />

      <LessonQA lessonId={id} />
    </div>
  );
}
