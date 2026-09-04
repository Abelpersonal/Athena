import Link from "next/link";
import { notFound } from "next/navigation";
import { getLessonWithSources } from "../../../src/db/queries.js";
import { chunkLessonAudio } from "../../../src/teachingEngine/chunkLessonAudio.js";
import { LessonAudioSection } from "../../../components/LessonAudioSection.js";
import { SourceCitations } from "../../../components/SourceCitations.js";
import { LessonQA } from "../../../components/LessonQA.js";

/**
 * The Lesson/Teaching screen. Phase 7.5 replaces the "Voice playback" placeholder with a real
 * `AudioPlayer` — `TTS_PROVIDER` is read server-side here (never exposed to the client) and
 * passed down as a plain "browser" | "server" mode prop, so TTS_PROVIDER=browser keeps the
 * client entirely off `/api/lessons/:id/audio` (see README).
 */
export default async function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getLessonWithSources(id);
  if (!detail) notFound();

  const { lesson, courseId, courseTopic, sourceRefs } = detail;
  const track = chunkLessonAudio(id, lesson.layers);
  const mode = (process.env.TTS_PROVIDER || "openai").toLowerCase() === "browser" ? "browser" : "server";

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/courses/${courseId}`} className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-accent)]">
          ← {courseTopic}
        </Link>
        <h1 className="text-xl font-medium mt-1">{lesson.title}</h1>
        <p className="text-sm text-[var(--color-text-muted)]">{lesson.description}</p>
      </div>

      <LessonAudioSection lessonId={id} layers={lesson.layers} track={track} mode={mode} />

      <SourceCitations sources={sourceRefs} />

      <LessonQA lessonId={id} ttsMode={mode} />
    </div>
  );
}
