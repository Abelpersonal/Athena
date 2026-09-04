"use client";

import { useEffect, useState } from "react";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

/**
 * Phase 10, Deliverable 5's subscribe/unsubscribe UI — the real `PushManager.subscribe()` flow,
 * gated behind an explicit opt-in click (never auto-prompted on page load, matching this app's
 * "explicit, not automatic" ethos already established for downloads — see the kickoff's own
 * Deliverable 3 note). Real Push requires a real browser with real notification permission; this
 * component degrades to "not supported here" text when `PushManager`/`Notification` aren't
 * present rather than rendering a button that can never work.
 */
export function PushNotificationToggle() {
  const [supported, setSupported] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setSupported(false);
      return;
    }
    void navigator.serviceWorker.ready.then(async (reg) => {
      const existing = await reg.pushManager.getSubscription();
      setSubscribed(existing !== null);
    });
  }, []);

  async function subscribe() {
    setLoading(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notification permission was not granted.");

      const keyRes = await fetch("/api/push/vapid-public-key");
      if (!keyRes.ok) throw new Error("Push notifications aren't configured on this server yet.");
      const { publicKey } = (await keyRes.json()) as { publicKey: string };

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });

      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      setSubscribed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function unsubscribe() {
    setLoading(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  if (!supported) {
    return <p className="text-sm text-[var(--color-text-faint)]">Push notifications aren&apos;t supported in this browser.</p>;
  }

  return (
    <div className="space-y-2">
      <button
        onClick={() => (subscribed ? void unsubscribe() : void subscribe())}
        disabled={loading}
        className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm hover:border-[var(--color-accent)] disabled:opacity-50"
      >
        {loading ? "…" : subscribed ? "Turn off notifications on this device" : "Turn on notifications on this device"}
      </button>
      {error && <p className="text-[var(--color-danger)] text-sm">{error}</p>}
    </div>
  );
}
