import Link from "next/link";

/** Phase 11, Deliverable 1: the real, styled 404 — rendered both for a genuinely unmatched route and every `notFound()` call already in this codebase (Lesson/Course/Practice/quiz/paths pages, an unknown lesson/course/module id). */
export default function NotFound() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-medium">Not found</h1>
      <p className="text-sm text-[var(--color-text-muted)]">This page, or whatever it was looking for, doesn&apos;t exist.</p>
      <Link href="/" className="inline-block min-h-11 items-center rounded-md bg-[var(--color-accent)] text-[#0b0e12] px-4 py-2 font-medium">
        Back to Dashboard
      </Link>
    </div>
  );
}
