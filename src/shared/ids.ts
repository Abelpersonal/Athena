/** Shared by the Research Agent (Phase 2) and Course Builder (Phase 3) to mint stable, readable, unique ids from LLM-authored titles. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface AssignUniqueIdsOptions {
  prefix?: string;
  /** Used when a title slugifies to an empty string. */
  fallback?: string;
}

export function assignUniqueIds(titles: string[], options: AssignUniqueIdsOptions = {}): string[] {
  const { prefix = "", fallback = "item" } = options;
  const seen = new Map<string, number>();
  return titles.map((title) => {
    const base = prefix + (slugify(title) || fallback);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  });
}
