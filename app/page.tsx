import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getDashboardCourses,
  getCompletedCourses,
  getActivePathsWithProgress,
  getMomentumStreak,
  getReentryOffer,
  getBoredomProofingSuggestions,
} from "../src/db/queries.js";
import { getWhatsNewDigest } from "../src/knowledgeUpdate/index.js";
import { getUserProfile, getGoalConnectionMessage } from "../src/motivation/index.js";
import { SuggestionsPanel } from "../components/SuggestionsPanel.js";
import { LoadingSkeleton } from "../components/LoadingSkeleton.js";

/**
 * Phase 10 fix (a real, pre-existing bug this build surfaced, predating this phase): every read
 * here goes through `node:sqlite` directly, a data source Next has no visibility into for its
 * static-vs-dynamic heuristics (unlike `cookies()`/`headers()`/an uncached `fetch`) — so `next
 * build` was silently prerendering this page as STATIC, freezing the onboarding-redirect and
 * every real Dashboard figure to whatever the database looked like at BUILD time, not per real
 * request. `npm run dev` never statically prerenders, so this was invisible until a real
 * production build was checked. Forcing dynamic rendering is the fix.
 */
export const dynamic = "force-dynamic";

/**
 * The Dashboard — a Server Component calling the read functions directly (no self-HTTP round-trip;
 * see README, "Server Components vs. API routes"). "Get suggestions" is the one client-interactive
 * piece, deliberately on-demand per completed course rather than eager for all of them.
 *
 * Phase 9: gated by a first-run redirect to /onboarding (Deliverable 1) when no UserProfile row
 * exists yet — skipping onboarding still creates the row (with an empty statedGoals), so this
 * fires exactly once per install, not on every visit. Momentum/re-entry/boredom-proofing/goal-
 * connection (Deliverables 2-4) are all real reads against ActivityEvent/UserProfile, computed
 * fresh on every load — no separate cached state to keep in sync.
 *
 * Phase 11, Deliverable 1: the slow part (the real eight-way `Promise.all` below) is split into
 * its own child component, `DashboardContent`, wrapped in a real `<Suspense>` HERE rather than via
 * a route-level `app/loading.tsx` file — a route-level loading file wraps THIS ENTIRE component in
 * Suspense, including the `redirect()` call above, and Next only sends a real HTTP 307 for a
 * redirect thrown BEFORE the response has started streaming. Once a Suspense boundary exists
 * anywhere in the tree, Next flushes a 200 immediately (to start streaming the fallback) and any
 * later `redirect()`/`notFound()` degrades to a soft, client-JS-driven navigation instead — a real
 * regression this exact restructuring was built to catch and fix (confirmed live: a route-level
 * `app/loading.tsx` here made a fresh, no-profile `GET /` return 200 instead of the real 307 this
 * app had every time before). Scoping the `<Suspense>` to ONLY the child that doesn't gate
 * anything keeps the redirect's real HTTP semantics while still giving the slow content its own
 * loading skeleton.
 */
export default async function DashboardPage() {
  const profile = await getUserProfile();
  if (!profile) redirect("/onboarding");

  return (
    <div className="space-y-10">
      <h1 className="sr-only">Dashboard</h1>
      <Suspense fallback={<LoadingSkeleton lines={4} />}>
        <DashboardContent />
      </Suspense>
    </div>
  );
}

async function DashboardContent() {
  const [inProgress, completed, activePaths, digest, streak, reentryOffer, boredomSuggestions, goalConnection] = await Promise.all([
    getDashboardCourses(),
    getCompletedCourses(),
    getActivePathsWithProgress(),
    getWhatsNewDigest(),
    getMomentumStreak(),
    getReentryOffer(),
    getBoredomProofingSuggestions(),
    getGoalConnectionMessage(),
  ]);

  // Simple heuristic for the one primary action: the most recently created in-progress course.
  const continueCourse = inProgress[0];

  return (
    <>
      {streak.currentStreakDays > 0 && (
        <p className="text-sm text-[var(--color-accent)]">
          {streak.currentStreakDays} day{streak.currentStreakDays === 1 ? "" : "s"} of momentum
        </p>
      )}

      {goalConnection && (
        <section className="rounded-lg border border-[var(--color-accent)]/30 p-3 text-sm">
          <p>{goalConnection.message}</p>
        </section>
      )}

      {continueCourse ? (
        <section>
          <Link
            href={`/courses/${continueCourse.id}`}
            className="inline-block rounded-lg bg-[var(--color-accent)] text-[#0b0e12] px-4 py-2 font-medium"
          >
            Continue: {continueCourse.topic}
          </Link>
        </section>
      ) : (
        <section>
          <Link
            href="/new"
            className="inline-block rounded-lg bg-[var(--color-accent)] text-[#0b0e12] px-4 py-2 font-medium"
          >
            Start something new
          </Link>
        </section>
      )}

      {reentryOffer && (
        <section className="space-y-1.5">
          <p className="text-xs text-[var(--color-text-faint)]">Low-energy day? Here&apos;s an easier way to show up:</p>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/quiz/${reentryOffer.lessonId}`}
              className="text-xs px-2.5 py-1 rounded-full border border-[var(--color-border)] hover:border-[var(--color-accent)]"
            >
              Quick review: {reentryOffer.lessonTitle}
            </Link>
            <Link
              href={`/quiz/${reentryOffer.lessonId}?tier=recall&count=1`}
              className="text-xs px-2.5 py-1 rounded-full border border-[var(--color-border)] hover:border-[var(--color-accent)]"
            >
              5-minute check-in
            </Link>
          </div>
        </section>
      )}

      {boredomSuggestions.length > 0 && (
        <section className="space-y-2">
          {boredomSuggestions.map((s) => (
            <div key={s.pathId} className="rounded-lg border border-[var(--color-border)] p-3 text-sm space-y-1">
              <p>{s.message}</p>
              <Link href="/new" className="text-[var(--color-accent)]">
                Explore something new →
              </Link>
            </div>
          ))}
        </section>
      )}

      <section>
        <h2 className="text-lg font-medium mb-3">In-progress courses</h2>
        {inProgress.length === 0 ? (
          <p className="text-[var(--color-text-muted)] text-sm">Nothing in progress yet.</p>
        ) : (
          <ul className="space-y-2">
            {inProgress.map((c) => (
              <li key={c.id} className="rounded-lg border border-[var(--color-border)] p-3">
                <Link href={`/courses/${c.id}`} className="hover:text-[var(--color-accent)]">
                  {c.topic}
                </Link>
                <span className="text-[var(--color-text-faint)] text-sm ml-2">
                  {c.lessonCount} lesson(s) · {c.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium mb-3">Active paths</h2>
        {activePaths.length === 0 ? (
          <p className="text-[var(--color-text-muted)] text-sm">No active goals/paths yet.</p>
        ) : (
          <ul className="space-y-2">
            {activePaths.map((p) => (
              <li key={p.id} className="rounded-lg border border-[var(--color-border)] p-3">
                <Link href={`/paths/${p.id}`} className="hover:text-[var(--color-accent)]">
                  {p.goalDescription}
                </Link>
                <span className="text-[var(--color-text-faint)] text-sm ml-2">
                  {p.doneCount}/{p.topicCount} topics
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium mb-3">What&apos;s new</h2>
        {digest.major.length === 0 && digest.moderate.length === 0 && digest.minor.length === 0 ? (
          <p className="text-[var(--color-text-muted)] text-sm">
            Nothing new — run <code>npm run knowledge-update</code> to check for updates.
          </p>
        ) : (
          <div className="space-y-2 text-sm">
            {digest.major.map((item) => (
              <div key={item.id} className="rounded-lg border border-[var(--color-warn)]/40 p-3">
                <p className="font-medium text-[var(--color-warn)]">{item.topicName}</p>
                <p>{item.deltaSummary}</p>
                {item.lessonUpdate && (
                  <p className="text-[var(--color-text-muted)] mt-1">{item.lessonUpdate.updatedGuidance}</p>
                )}
              </div>
            ))}
            {digest.moderate.map((item) => (
              <p key={item.id} className="text-[var(--color-text-muted)]">
                {item.topicName}: {item.deltaSummary}
              </p>
            ))}
            {digest.minor.length > 0 && (
              <p className="text-[var(--color-text-faint)]">{digest.minor.length} minor item(s) not shown.</p>
            )}
          </div>
        )}
      </section>

      {completed.length > 0 && (
        <section>
          <h2 className="text-lg font-medium mb-3">Completed courses</h2>
          <ul className="space-y-3">
            {completed.map((c) => (
              <li key={c.id} className="rounded-lg border border-[var(--color-border)] p-3">
                <Link href={`/courses/${c.id}`} className="hover:text-[var(--color-accent)]">
                  {c.topic}
                </Link>
                <SuggestionsPanel courseId={c.id} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-[var(--color-text-faint)]">
        <Link href="/onboarding" className="underline">
          Edit what you&apos;re working toward
        </Link>
      </p>
    </>
  );
}
