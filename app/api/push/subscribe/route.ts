import { savePushSubscription, type PushSubscriptionKeys } from "../../../../src/push/index.js";

export const runtime = "nodejs";

/** Thin wrapper over savePushSubscription() — the client's PushManager.subscribe() result POSTed here verbatim (PushSubscription.toJSON() already has this exact {endpoint, keys: {p256dh, auth}} shape). */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as PushSubscriptionKeys | null;
  if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return Response.json({ message: "Missing required subscription fields." }, { status: 400 });
  }
  await savePushSubscription(body);
  return Response.json({ ok: true });
}
