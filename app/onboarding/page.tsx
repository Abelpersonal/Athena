import { getUserProfile } from "../../src/motivation/index.js";
import { OnboardingClient } from "../../components/OnboardingClient.js";

/** Deliverable 1's screen — also reused as the Dashboard's "edit what you're working toward" link, pre-filled with whatever's already saved. */
export default async function OnboardingPage() {
  const profile = await getUserProfile();
  return <OnboardingClient initialGoals={profile?.statedGoals ?? []} />;
}
