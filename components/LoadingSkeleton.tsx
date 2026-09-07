/** Phase 11: the one shared pulsing-block skeleton every route's `loading.tsx` composes from — a single place to tune the "something's happening" look, not a separate hand-drawn layout per route. */
export function LoadingSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-6 animate-pulse" role="status" aria-label="Loading">
      <div className="h-8 w-48 rounded-md bg-[var(--color-surface-raised)]" />
      <div className="space-y-2">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="h-16 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]" />
        ))}
      </div>
    </div>
  );
}
