import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

/**
 * Coarse, honestly-derived source category — grounded in what the fetch
 * actually observed, not a fabricated paywall/video detector:
 *   - "unreachable": the fetch itself failed (network error, non-2xx, body read failure)
 *   - "pdf" / "video" / "other": reached, but the Content-Type wasn't HTML
 *   - "low_confidence": HTML was reached and read, but Readability found nothing
 *     usable (empty parse, parse exception, or too-short text) — commonly caused
 *     by paywalls, login walls, or JS-rendered pages, but that cause is never
 *     asserted since it isn't actually detected
 *   - "article": a real, usable extraction (extractionConfidence > 0)
 */
export type SourceType = "article" | "pdf" | "video" | "other" | "unreachable" | "low_confidence";

/**
 * Result of a content-extraction attempt. Always resolves — never rejects
 * and never returns null — so callers uniformly check extractionConfidence
 * rather than branching on success/failure. A confidence of 0 means the
 * result is unusable (failed fetch, non-HTML, no article found, too short)
 * and callers should exclude it rather than treat text/title as real content.
 */
export interface CleanedContent {
  text: string;
  title: string;
  extractionConfidence: number;
  sourceType: SourceType;
}

const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT =
  "TeacherResearchBot/0.1 (+personal educational research project; single on-demand fetch, no crawling)";
/** Below this, Readability's output is too thin to trust even if it "succeeded". */
const MIN_USABLE_TEXT_LENGTH = 200;
/** At/above this length, confidence caps out at 1. */
const CONFIDENT_TEXT_LENGTH = 3000;

function emptyResult(sourceType: SourceType): CleanedContent {
  return { text: "", title: "", extractionConfidence: 0, sourceType };
}

function classifyNonHtmlContentType(contentType: string): SourceType {
  if (contentType.includes("pdf")) return "pdf";
  if (contentType.startsWith("video/")) return "video";
  return "other";
}

/**
 * Fetches a URL and extracts its main article content via Readability.js.
 * This is a lightweight, in-process version of what Phase 3's Material
 * Aggregator will later persist/cache — kept as a standalone module with
 * this exact signature so that phase can extend it (e.g. add a Trafilatura
 * fallback for low-confidence pages) rather than replace it.
 *
 * No Trafilatura fallback in this phase (documented gap, not built) — a
 * low-confidence result is simply excluded from the caller's source set.
 */
export async function fetchAndClean(url: string): Promise<CleanedContent> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
    });
  } catch (error) {
    console.warn(`[extraction] Fetch failed for ${url}: ${(error as Error).message}`);
    return emptyResult("unreachable");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    console.warn(`[extraction] Fetch returned HTTP ${response.status} for ${url}`);
    return emptyResult("unreachable");
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("html")) {
    console.warn(`[extraction] Skipping non-HTML content-type "${contentType}" for ${url}`);
    return emptyResult(classifyNonHtmlContentType(contentType));
  }

  let html: string;
  try {
    html = await response.text();
  } catch (error) {
    console.warn(`[extraction] Failed to read response body for ${url}: ${(error as Error).message}`);
    return emptyResult("unreachable");
  }

  try {
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();

    if (!article?.textContent) {
      console.warn(`[extraction] Readability found no article content for ${url}`);
      return emptyResult("low_confidence");
    }

    const text = article.textContent.trim();
    const title = article.title?.trim() ?? "";
    const extractionConfidence = scoreConfidence(text, title);
    return {
      text,
      title,
      extractionConfidence,
      sourceType: extractionConfidence > 0 ? "article" : "low_confidence",
    };
  } catch (error) {
    console.warn(`[extraction] Readability/JSDOM parse failed for ${url}: ${(error as Error).message}`);
    return emptyResult("low_confidence");
  }
}

/**
 * Confidence heuristic for v1: mostly a function of extracted text length,
 * with a small bonus for a non-empty title. Not a rigorous classifier —
 * good enough to gate "usable enough to cite" vs. "exclude this source".
 */
function scoreConfidence(text: string, title: string): number {
  if (text.length < MIN_USABLE_TEXT_LENGTH) return 0;
  const lengthScore = Math.min(1, text.length / CONFIDENT_TEXT_LENGTH);
  const titleBonus = title.length > 0 ? 0.05 : 0;
  return Math.round(Math.min(1, lengthScore * 0.95 + titleBonus) * 100) / 100;
}
