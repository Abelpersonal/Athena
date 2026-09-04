import { saveUserProfile } from "../../../src/motivation/index.js";

export const runtime = "nodejs";

/** Thin wrapper over saveUserProfile() — Deliverable 1's onboarding write, including an explicit "skip" (body: { statedGoals: [] }). */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { statedGoals?: unknown };
  const statedGoals = Array.isArray(body.statedGoals)
    ? body.statedGoals.filter((g): g is string => typeof g === "string" && g.trim().length > 0)
    : [];
  await saveUserProfile(statedGoals);
  return Response.json({ statedGoals });
}
