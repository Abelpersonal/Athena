import { getUserProfile } from "../../src/motivation/index.js";
import { OnboardingClient } from "../../components/OnboardingClient.js";

/** Same real bug/fix as app/page.tsx (Phase 10) — this reads real per-request DB state (the current stated goals) and must never be frozen to build-time content. */
export const dynamic = "force-dynamic";

/** Deliverable 1's screen — also reused as the Dashboard's "edit what you're working toward" link, pre-filled with whatever's already saved. */
export default async function OnboardingPage() {
  const profile = await getUserProfile();
  return <OnboardingClient initialGoals={profile?.statedGoals ?? []} />;
}
