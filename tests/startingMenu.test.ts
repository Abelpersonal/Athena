import { describe, it, expect } from "vitest";
import { STARTING_MENU, STARTING_MENU_CATEGORIES } from "../src/startingMenu/data.js";

describe("starting menu data (Phase 8, Open Decision 7 — fixed taxonomy, no LLM/DB involved)", () => {
  it("has roughly 30 entries across the PRD's 8 named categories", () => {
    expect(STARTING_MENU.length).toBeGreaterThanOrEqual(24);
    expect(STARTING_MENU.length).toBeLessThanOrEqual(40);
    expect(STARTING_MENU_CATEGORIES).toHaveLength(8);
  });

  it("every entry has the fields the /new entry screen expects: id, label, category, prompt", () => {
    for (const entry of STARTING_MENU) {
      expect(entry.id).toBeTruthy();
      expect(entry.label).toBeTruthy();
      expect(entry.category).toBeTruthy();
      expect(entry.prompt).toBeTruthy();
    }
  });

  it("every entry's category is one of the declared STARTING_MENU_CATEGORIES", () => {
    for (const entry of STARTING_MENU) {
      expect(STARTING_MENU_CATEGORIES).toContain(entry.category);
    }
  });

  it("every category is actually used by at least one entry", () => {
    const usedCategories = new Set(STARTING_MENU.map((e) => e.category));
    for (const category of STARTING_MENU_CATEGORIES) {
      expect(usedCategories.has(category)).toBe(true);
    }
  });

  it("every entry id is unique", () => {
    const ids = STARTING_MENU.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes at least one entry whose prompt is genuinely goal-shaped (multi-domain, not a single topic) per the PRD's own example", () => {
    const hasFinancialIndependence = STARTING_MENU.some((e) => e.prompt.toLowerCase().includes("financially independent"));
    expect(hasFinancialIndependence).toBe(true);
  });
});
