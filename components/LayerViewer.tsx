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
 */
export function LayerViewer({ layers }: { layers: LessonLayers }) {
  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-sm font-medium text-[var(--color-text-muted)] mb-1">Intuition</h3>
        <p className="leading-relaxed">{layers.intuition.text}</p>
      </section>

      <details className="disclosure">
        <summary className="text-sm">Go deeper (mechanics / formal / application / frontier)</summary>
        <div className="mt-3 space-y-4">
          {DEEPER_LAYERS.map(({ key, label }) => (
            <section key={key}>
              <h3 className="text-sm font-medium text-[var(--color-text-muted)] mb-1">{label}</h3>
              <p className="leading-relaxed">{layers[key].text}</p>
            </section>
          ))}
        </div>
      </details>
    </div>
  );
}
