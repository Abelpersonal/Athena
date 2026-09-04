import { resolvePendingItems, successfulIds, type PostFn } from "../../src/offline/outbox.js";
import { listOutboxItems, removeOutboxItems } from "./db.js";

/** The real `post`: a plain `fetch` POST, translated into the pure resolver's `PostFn` shape. */
const realPost: PostFn = async (url, payload) => {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      return { ok: false, error: body.message ?? `Request failed with status ${res.status}.` };
    }
    return { ok: true, body: await res.json() };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
};

/**
 * Registers a real Background Sync request for the outbox right after an item is queued, so the
 * service worker can resolve it even with no tab open — the primary mechanism (Deliverable 4).
 * Not supported everywhere (notably Safari/iOS has no Background Sync API at all); this
 * degrades to a silent no-op there, relying entirely on the documented fallback instead: the
 * page's own `online` event listener (`ServiceWorkerRegister.tsx`) calling `attemptSync()`
 * directly once connectivity returns.
 */
export async function registerBackgroundSync(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if ("sync" in reg) {
      await (reg as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register(
        "athena-outbox-sync"
      );
    }
  } catch {
    // Background Sync unsupported/denied — the `online` event fallback still covers this.
  }
}

export interface SyncResult {
  attempted: number;
  resolved: number;
}

/**
 * Phase 10, Deliverable 4: the real "attempt sync" call — reads the real IndexedDB outbox, runs
 * the pure `resolvePendingItems` (src/offline/outbox.ts) against a real `fetch`, and deletes
 * whichever items actually resolved. Resolving against the SAME real routes every online action
 * already uses (`/api/lessons/:id/ask`, `/api/quiz/:id/score`) means every real side effect those
 * routes already have — Phase 9's `recordActivityEvent`, milestone checks, MasteryState updates —
 * fires for real once a queued item finally sends, not a parallel sync-only code path.
 *
 * Called from three places: the page's own `online` event listener (the documented fallback for
 * browsers without Background Sync — notably Safari/iOS, a real, known gap — see README), the
 * service worker's `sync` event handler for browsers that DO support it, and a manual "Retry now"
 * action a pending item's UI can offer.
 */
export async function attemptSync(): Promise<SyncResult> {
  const items = await listOutboxItems();
  if (items.length === 0) return { attempted: 0, resolved: 0 };

  const resolutions = await resolvePendingItems(items, realPost);
  const resolvedIds = successfulIds(resolutions);
  if (resolvedIds.length > 0) await removeOutboxItems(resolvedIds);

  return { attempted: items.length, resolved: resolvedIds.length };
}
