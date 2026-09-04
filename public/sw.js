/**
 * Phase 10, Deliverable 1/3/4: a hand-rolled service worker, not next-pwa/Workbox — this project
 * already pins a deliberately customized webpack config (next.config.ts's `resolve.extensionAlias`
 * fix for NodeNext `.js`-extension imports), and next-pwa's own webpack plugin has a real history
 * of fighting custom webpack configs and lagging Next.js major-version support. A hand-rolled
 * classic-script (not `{type: "module"}`) service worker needs zero extra dependencies, and
 * classic scripts are what Safari's Background Sync/Push implementations require anyway — see
 * README, "Service worker tooling: hand-rolled, not next-pwa."
 *
 * Duplicates the outbox object-store shape from lib/offline/db.ts by necessity: a classic-script
 * service worker can't `import` an ES module the way page code can, so the sync handler below
 * re-opens the SAME IndexedDB database directly rather than sharing that file — see README for
 * the exact shape both sides agree on.
 */

const CACHE_VERSION = "athena-v1";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-maskable.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

/** Network-first for same-origin GET requests: try the network, cache a clone of a real success, fall back to the cache on failure — the mechanism that makes "download for offline" (Deliverable 3) actually work once the page/API routes it pre-fetched are cached. */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || Response.error()))
  );
});

/** A page sends this after a real "Download for offline" click — pre-fetches and caches a course's real pages so they're readable offline even if the learner never visited them while online. */
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === "CACHE_URLS") {
    event.waitUntil(
      caches.open(CACHE_VERSION).then(async (cache) => {
        for (const url of data.urls || []) {
          try {
            const response = await fetch(url);
            if (response.ok) await cache.put(url, response);
          } catch {
            // One page failing to pre-cache doesn't abort the rest.
          }
        }
        const client = await self.clients.get(event.source.id);
        client?.postMessage({ type: "CACHE_URLS_DONE" });
      })
    );
    return;
  }

  /** The storage-management UI's real "remove downloaded course" action — clears exactly the cache entries that course's download populated, so the freed space is real, not just IndexedDB's share of it. */
  if (data.type === "CLEAR_URLS") {
    event.waitUntil(
      caches.open(CACHE_VERSION).then(async (cache) => {
        for (const url of data.urls || []) await cache.delete(url);
      })
    );
  }
});

// ---------------------------------------------------------------------------
// Web Push (Deliverable 5) — displays whatever payload src/push/index.ts's buildXPushPayload()
// functions constructed server-side ({title, body, url}), and navigates to `url` on click.
// ---------------------------------------------------------------------------

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon.svg",
      data: { url: payload.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus().then(() => existing.navigate(url));
      return self.clients.openWindow(url);
    })
  );
});

// ---------------------------------------------------------------------------
// Background Sync (Deliverable 4) — real IndexedDB outbox access from the SW itself, so a queued
// item can resolve even with no tab open. Not supported in every browser (notably Safari/iOS has
// no Background Sync API at all) — lib/offline/sync.ts's `attemptSync()` plus an `online` event
// listener on the page is the documented fallback; see README.
// ---------------------------------------------------------------------------

const OUTBOX_DB_NAME = "athena-offline";
const OUTBOX_STORE = "outbox";

function openOutboxDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OUTBOX_DB_NAME, 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    // No onupgradeneeded here deliberately — the page (lib/offline/db.ts) always opens first and
    // owns schema creation; if the SW is somehow first, an empty outbox read is a safe no-op.
  });
}

function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function resolveOutboxInServiceWorker() {
  let db;
  try {
    db = await openOutboxDb();
  } catch {
    return;
  }
  if (!db.objectStoreNames.contains(OUTBOX_STORE)) return;

  const items = await idbRequest(db.transaction(OUTBOX_STORE, "readonly").objectStore(OUTBOX_STORE).getAll());
  for (const item of items) {
    try {
      const res = await fetch(item.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item.payload) });
      if (res.ok) {
        const tx = db.transaction(OUTBOX_STORE, "readwrite");
        tx.objectStore(OUTBOX_STORE).delete(item.id);
      }
    } catch {
      // Still offline / still failing — leave it queued for the next sync attempt.
    }
  }

  const clients = await self.clients.matchAll();
  for (const client of clients) client.postMessage({ type: "OUTBOX_SYNCED" });
}

self.addEventListener("sync", (event) => {
  if (event.tag === "athena-outbox-sync") {
    event.waitUntil(resolveOutboxInServiceWorker());
  }
});
