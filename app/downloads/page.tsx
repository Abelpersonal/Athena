import { DownloadsManager } from "../../components/DownloadsManager.js";
import { PushNotificationToggle } from "../../components/PushNotificationToggle.js";

/** Phase 10's one settings-adjacent screen: storage management (Deliverable 3) plus the push opt-in (Deliverable 5) — a single simple screen rather than two, per the kickoff's "no need for a dedicated new screen beyond that." */
export default function DownloadsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-medium">Downloads &amp; notifications</h1>
      </div>
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Downloaded for offline</h2>
        <DownloadsManager />
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Notifications</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          Real-time alerts for major knowledge updates and an occasional, low-pressure nudge if a goal path goes quiet.
        </p>
        <PushNotificationToggle />
      </section>
    </div>
  );
}
