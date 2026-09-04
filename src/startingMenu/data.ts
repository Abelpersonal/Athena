/**
 * Phase 8's self-improvement starting menu (PRD §6.2 screen 1, Open Decision 7). A FIXED, curated
 * taxonomy — content, not agent output: no LLM call, no DB table. This is the "fixed curated
 * taxonomy (recommended for v1)" branch of Open Decision 7, not the "fully AI-generated dynamic
 * menu" branch (which would need Continuous Learning Agent logic earlier than phased). Categories
 * are the PRD's own §1 list. Selecting an entry just pre-fills the existing free-text input on
 * `/new` and runs through Phase 7's classify-confirm-override flow completely unchanged — most
 * entries here read as a single topic; a few (financial independence, career growth) are
 * deliberately goal-shaped, matching the PRD's own "become financially independent" example — a
 * goal classification for one of those is expected, not a bug.
 */

export type StartingMenuCategory =
  | "Mindset"
  | "Focus"
  | "Emotional Intelligence"
  | "Communication"
  | "Health"
  | "Financial Literacy"
  | "Decision-Making"
  | "Career Growth";

export const STARTING_MENU_CATEGORIES: StartingMenuCategory[] = [
  "Mindset",
  "Focus",
  "Emotional Intelligence",
  "Communication",
  "Health",
  "Financial Literacy",
  "Decision-Making",
  "Career Growth",
];

export interface StartingMenuEntry {
  id: string;
  label: string;
  category: StartingMenuCategory;
  /** The exact text fed into classifyInput() / the free-text input when this entry is picked. */
  prompt: string;
}

export const STARTING_MENU: StartingMenuEntry[] = [
  // Mindset
  { id: "growth-mindset", label: "Growth mindset", category: "Mindset", prompt: "Growth mindset" },
  { id: "overcoming-imposter-syndrome", label: "Overcoming imposter syndrome", category: "Mindset", prompt: "Overcoming imposter syndrome" },
  { id: "cognitive-biases", label: "Common cognitive biases", category: "Mindset", prompt: "Common cognitive biases and how to counter them" },
  { id: "building-resilience", label: "Building resilience", category: "Mindset", prompt: "Building psychological resilience" },

  // Focus
  { id: "deep-work", label: "Deep work", category: "Focus", prompt: "Deep work — sustained, focused attention" },
  { id: "managing-distraction", label: "Managing digital distraction", category: "Focus", prompt: "Managing digital distraction and attention" },
  { id: "time-blocking", label: "Time blocking", category: "Focus", prompt: "Time blocking as a productivity method" },
  { id: "habit-formation", label: "Habit formation", category: "Focus", prompt: "The science of habit formation" },

  // Emotional Intelligence
  { id: "emotional-regulation", label: "Emotional regulation", category: "Emotional Intelligence", prompt: "Emotional regulation" },
  { id: "reading-others-emotions", label: "Reading others' emotions", category: "Emotional Intelligence", prompt: "Reading and understanding others' emotions" },
  { id: "self-awareness", label: "Building self-awareness", category: "Emotional Intelligence", prompt: "Building self-awareness" },

  // Communication
  { id: "active-listening", label: "Active listening", category: "Communication", prompt: "Active listening" },
  { id: "difficult-conversations", label: "Navigating difficult conversations", category: "Communication", prompt: "Navigating difficult conversations" },
  { id: "public-speaking", label: "Public speaking", category: "Communication", prompt: "Public speaking" },
  { id: "persuasion-and-influence", label: "Persuasion and influence", category: "Communication", prompt: "Persuasion and influence" },

  // Health
  { id: "sleep-science", label: "The science of sleep", category: "Health", prompt: "The science of sleep" },
  { id: "stress-management", label: "Stress management", category: "Health", prompt: "Stress management" },
  { id: "nutrition-basics", label: "Nutrition fundamentals", category: "Health", prompt: "Nutrition fundamentals" },
  { id: "exercise-physiology", label: "Exercise physiology basics", category: "Health", prompt: "Exercise physiology basics" },

  // Financial Literacy
  { id: "personal-budgeting", label: "Personal budgeting", category: "Financial Literacy", prompt: "Personal budgeting" },
  { id: "investing-fundamentals", label: "Investing fundamentals", category: "Financial Literacy", prompt: "Investing fundamentals" },
  {
    id: "financial-independence",
    label: "Become financially independent",
    category: "Financial Literacy",
    prompt: "become financially independent",
  },
  { id: "understanding-debt", label: "Understanding debt", category: "Financial Literacy", prompt: "Understanding debt and how to manage it" },

  // Decision-Making
  { id: "decision-frameworks", label: "Decision-making frameworks", category: "Decision-Making", prompt: "Decision-making frameworks" },
  { id: "probabilistic-thinking", label: "Probabilistic thinking", category: "Decision-Making", prompt: "Probabilistic thinking" },
  { id: "avoiding-sunk-cost", label: "Avoiding the sunk cost fallacy", category: "Decision-Making", prompt: "The sunk cost fallacy and how to avoid it" },

  // Career Growth
  { id: "negotiation-skills", label: "Negotiation skills", category: "Career Growth", prompt: "Negotiation skills" },
  { id: "networking-effectively", label: "Networking effectively", category: "Career Growth", prompt: "Networking effectively" },
  {
    id: "advance-into-leadership",
    label: "Advance into a leadership role",
    category: "Career Growth",
    prompt: "advance into a leadership role at work",
  },
  { id: "personal-branding", label: "Personal branding", category: "Career Growth", prompt: "Personal branding" },
];
