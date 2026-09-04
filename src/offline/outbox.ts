/**
 * Phase 10, Deliverable 4: the pure core of the offline outbox's resolve-on-reconnect logic — no
 * IndexedDB, no `fetch`, no service worker — so it's directly unit testable with a mocked `post`
 * function. The real browser-side glue (`lib/offline/db.ts`) is a thin wrapper around this: it
 * reads pending items out of IndexedDB, calls `resolvePendingItems` with a real `fetch`-based
 * `post`, then deletes whichever items resolved successfully. That glue itself isn't unit tested
 * — it needs a real browser's IndexedDB, which this environment doesn't have (see README).
 *
 * Exactly two outbox item types exist, per PRD §6.4's own hard-boundary list: a mid-lesson
 * question asked while offline (`ask_question`, resolved against `/api/lessons/:id/ask`) and a
 * quiz submitted while offline (`quiz_score`, resolved against `/api/quiz/:id/score`) — the SAME
 * real routes every online action already uses, so a synced item triggers every real side effect
 * that route already has (Phase 9's `recordActivityEvent`, milestone checks, MasteryState
 * updates) rather than a parallel, easier-to-drift sync-only code path.
 */

export type OutboxItemType = "ask_question" | "quiz_score";

export interface OutboxItem {
  id: string;
  type: OutboxItemType;
  /** The real route this item resolves against, e.g. `/api/lessons/:id/ask` or `/api/quiz/:id/score`. */
  url: string;
  /** The exact JSON body the real route expects — identical to what an online call would send. */
  payload: unknown;
  createdAt: string;
}

export interface PostResult {
  ok: boolean;
  body?: unknown;
  error?: string;
}

export type PostFn = (url: string, payload: unknown) => Promise<PostResult>;

export interface OutboxResolution {
  id: string;
  success: boolean;
  responseBody?: unknown;
  error?: string;
}

/**
 * Attempts every pending item in order, stopping at nothing — a failure on one item doesn't block
 * the rest (a transient failure on one quiz score shouldn't hold a queued question hostage).
 * Returns one resolution per item; the caller (real IndexedDB glue) is responsible for actually
 * removing the successfully-resolved ones from the queue — this function has no persistence of
 * its own, deliberately, so it's safe to call with a partial or reordered item list in a test.
 */
export async function resolvePendingItems(items: OutboxItem[], post: PostFn): Promise<OutboxResolution[]> {
  const results: OutboxResolution[] = [];
  for (const item of items) {
    try {
      const result = await post(item.url, item.payload);
      results.push(
        result.ok
          ? { id: item.id, success: true, responseBody: result.body }
          : { id: item.id, success: false, error: result.error ?? "Request failed." }
      );
    } catch (error) {
      results.push({ id: item.id, success: false, error: (error as Error).message });
    }
  }
  return results;
}

/** Convenience for the UI/glue layer: which item ids actually resolved, so they can be deleted from the real queue. */
export function successfulIds(resolutions: OutboxResolution[]): string[] {
  return resolutions.filter((r) => r.success).map((r) => r.id);
}
