"use client";

import { useEffect } from "react";
import { attemptSync } from "../lib/offline/sync.js";

/**
 * Phase 10, Deliverable 1: registers `public/sw.js` on mount — the one piece of client JS every
 * page needs, mounted once from the root layout. Also the documented Background Sync fallback
 * (Deliverable 4): a plain `online` event listener that calls the SAME `attemptSync()` the
 * service worker's own `sync` event handler uses, for browsers without the Background Sync API
 * (notably Safari/iOS — a real, known gap, not something this project can work around).
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Service worker registration failed:", error);
    });

    const onOnline = () => {
      void attemptSync();
    };
    window.addEventListener("online", onOnline);

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "OUTBOX_SYNCED") void attemptSync();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);

    return () => {
      window.removeEventListener("online", onOnline);
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, []);

  return null;
}
