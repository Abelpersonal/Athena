"use client";

export interface LessonLayers {
  intuition: { text: string };
  mechanics: { text: string };
  formal: { text: string };
  application: { text: string };
  frontier: { text: string };
}

const DEEPER_LAYERS: Array<{ key: keyof LessonLayers; label: string }> = [
  { key: "mechanics", label: "Mechanics" },
  { key: "formal", label: "Formal" },
  { key: "application", label: "Application" },
  { key: "frontier", label: "Frontier" },
];

/**
 * Renders a lesson's five depth layers as text — intuition shown by default, everything deeper
 * behind an explicit toggle, per §6.1's "one clear question per screen... depth one tap away, not
 * dumped all at once" principle.
 *
 * `onDeeperLayersToggle` (Phase 7.5, small additive change — content/markup otherwise unchanged):
 * fires when the "Go deeper" disclosure opens/closes, so `components/LessonAudioSection.tsx` can
 * gate audio synthesis on the SAME expand state this component already tracks natively — a
 * collapsed formal/frontier layer must never have its audio force-generated. Optional; omitting it
 * leaves this component's behavior identical to Phase 7's.
 */
export function LayerViewer({
  layers,
  onDeeperLayersToggle,
}: {
  layers: LessonLayers;
  onDeeperLayersToggle?: (open: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <section>
        <h2 className="text-sm font-medium text-[var(--color-text-muted)] mb-1">Intuition</h2>
        <p className="leading-relaxed">{layers.intuition.text}</p>
      </section>

      <details
        className="disclosure"
        onToggle={(e) => onDeeperLayersToggle?.(e.currentTarget.open)}
      >
        <summary className="text-sm">Go deeper (mechanics / formal / application / frontier)</summary>
        <div className="mt-3 space-y-4">
          {DEEPER_LAYERS.map(({ key, label }) => (
            <section key={key}>
              <h2 className="text-sm font-medium text-[var(--color-text-muted)] mb-1">{label}</h2>
              <p className="leading-relaxed">{layers[key].text}</p>
            </section>
          ))}
        </div>
      </details>
    </div>
  );
}
