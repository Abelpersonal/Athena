import { notFound } from "next/navigation";
import { getLessonWithSources } from "../../../src/db/queries.js";
import { QuizClient } from "../../../components/QuizClient.js";

export default async function QuizPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params;
  const detail = await getLessonWithSources(lessonId);
  if (!detail) notFound();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-medium">Quiz: {detail.lesson.title}</h1>
      <QuizClient lessonId={lessonId} courseId={detail.courseId} />
    </div>
  );
}
