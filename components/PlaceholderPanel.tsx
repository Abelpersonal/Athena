/**
 * A visible, clearly-labeled stub for a feature that belongs to a later phase — Mind Map (Phase
 * 8), voice/TTS playback (Phase 7.5), Motivation Layer engagement mechanics (Phase 9). Per the
 * Phase 7 kickoff prompt: "visually present but clearly labeled as not-yet-built... not omitted
 * entirely and not faked with static content" — the same "don't skip the stub silently" discipline
 * Phase 3 used for the Memory Graph write before Phase 3.5 existed.
 */
export function PlaceholderPanel({ label, note }: { label: string; note?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/50 px-4 py-3 text-sm text-[var(--color-text-faint)]">
      <span className="font-medium">{label}</span>
      {note ? <span> — {note}</span> : null}
    </div>
  );
}
