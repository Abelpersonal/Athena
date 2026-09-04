import { deletePushSubscription } from "../../../../src/push/index.js";

export const runtime = "nodejs";

/** Thin wrapper over deletePushSubscription() — called when the learner turns notifications off, or when PushManager reports the subscription itself expired client-side. */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { endpoint?: string };
  if (!body.endpoint) {
    return Response.json({ message: "Missing required 'endpoint' field." }, { status: 400 });
  }
  await deletePushSubscription(body.endpoint);
  return Response.json({ ok: true });
}
