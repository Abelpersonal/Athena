import { notFound } from "next/navigation";
import { getLessonWithSources } from "../../../src/db/queries.js";
import { QuizClient } from "../../../components/QuizClient.js";

const VALID_TIERS = new Set(["recall", "application", "transfer"]);

/**
 * `?tier=<recall|application|transfer>&count=<n>` (Phase 9): how the Dashboard's "5-minute
 * check-in" low-friction re-entry offer (src/motivation/, src/db/queries.ts's getReentryOffer)
 * starts a genuinely single-question, single-tier session on the weakest concept node — the SAME
 * generateQuizQuestions() path every other quiz session uses, just parameterized differently, not
 * a second quiz-generation path.
 */
export default async function QuizPage({
  params,
  searchParams,
}: {
  params: Promise<{ lessonId: string }>;
  searchParams: Promise<{ tier?: string; count?: string }>;
}) {
  const { lessonId } = await params;
  const sp = await searchParams;
  const detail = await getLessonWithSources(lessonId);
  if (!detail) notFound();

  const tier = sp.tier && VALID_TIERS.has(sp.tier) ? (sp.tier as "recall" | "application" | "transfer") : undefined;
  const questionsPerTier = sp.count ? Number(sp.count) : undefined;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-medium">Quiz: {detail.lesson.title}</h1>
      <QuizClient
        lessonId={lessonId}
        courseId={detail.courseId}
        tiers={tier ? [tier] : undefined}
        questionsPerTier={questionsPerTier}
      />
    </div>
  );
}
