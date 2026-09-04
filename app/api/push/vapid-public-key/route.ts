export const runtime = "nodejs";

/** The client's PushManager.subscribe() call needs the real VAPID public key — this is the one way it gets it, rather than hardcoding a NEXT_PUBLIC_ env var, keeping VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY together as plain server-only env vars per the kickoff's named convention. */
export async function GET(): Promise<Response> {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return Response.json({ message: "Push notifications aren't configured on this server (VAPID_PUBLIC_KEY unset)." }, { status: 503 });
  }
  return Response.json({ publicKey });
}
