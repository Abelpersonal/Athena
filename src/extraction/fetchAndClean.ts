import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import type { Locator } from "../shared/locator.js";
import { parsePdf as parsePdfDefault, type ParsePdfFn } from "./fetchAndCleanPdf.js";
import { getTranscript as getTranscriptDefault, type TranscriptProvider } from "../mcp/youtubeTranscript.js";
import { isSafeToFetch } from "../shared/urlSafety.js";

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

/** One real chunk of a "pdf"/"video" source's text — a page or a caption-timestamp window — with the locator that anchors it. Absent for "article"/"other" sources, exactly like today (a single flat `text` blob, no chunking concept at all). */
export interface ContentChunk {
  text: string;
  locator?: Locator;
}

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
  /** Per-page (PDF)/per-timestamp-segment (video) breakdown, when the source type supports it — threaded into `SourceRecord.chunks` (src/research/types.ts) by `research/pipeline.ts`, which fans it out into multiple tagged `SourceExcerpt`s for `extract_grounded_key_points` instead of one flat excerpt. */
  chunks?: ContentChunk[];
  /** The source's own known real extent (PDF page count / video duration in whole seconds) — carried alongside `chunks` purely for the locator sanity check (src/research/grounding.ts); never used for citation validation itself. */
  maxLocatorValue?: number;
}

const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT =
  "TeacherResearchBot/0.1 (+personal educational research project; single on-demand fetch, no crawling)";
/** Below this, Readability's output is too thin to trust even if it "succeeded". Also reused for the PDF/video text-length confidence heuristic (Deliverables 2/3) — one definition of "usable enough to cite", not a second one that could drift. */
const MIN_USABLE_TEXT_LENGTH = 200;
/** At/above this length, confidence caps out at 1. */
const CONFIDENT_TEXT_LENGTH = 3000;

export interface FetchAndCleanOptions {
  /** Injectable for tests. Default: the real `pdf-parse`-backed extractor (src/extraction/fetchAndCleanPdf.ts). */
  parsePdf?: ParsePdfFn;
  /** Injectable for tests. Default: the real YouTube transcript MCP adapter (src/mcp/youtubeTranscript.ts). */
  getTranscript?: TranscriptProvider["getTranscript"];
}

function emptyResult(sourceType: SourceType): CleanedContent {
  return { text: "", title: "", extractionConfidence: 0, sourceType };
}

function classifyNonHtmlContentType(contentType: string): SourceType {
  if (contentType.includes("pdf")) return "pdf";
  if (contentType.startsWith("video/")) return "video";
  return "other";
}

/**
 * The real bug this phase fixes: a YouTube watch page's `Content-Type` is `text/html` — Tavily
 * search surfaces YouTube URLs constantly, and before this check existed, one of those URLs fell
 * straight into the Readability/article path below and got whatever garbage Readability scraped
 * from a video player page's chrome (or a low-confidence empty result), never reaching the
 * transcript adapter at all. Checked by URL PATTERN, before any HTTP request is even made — a
 * video URL never needs its `Content-Type` header sniffed, unlike PDF (which genuinely does need
 * a real HTTP round-trip first, since there's no reliable URL-only signal for "this is a PDF").
 * `youtube.com/watch`, `youtu.be/` (and `/shorts/`, which redirects to the same watch flow) are
 * the patterns recognized — documented here as the exhaustive list, not "at minimum" language
 * that invites silent scope creep.
 */
function isYoutubeVideoUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.replace(/^www\./, "");
  if (host === "youtu.be") return parsed.pathname.length > 1;
  if (host === "youtube.com" || host === "m.youtube.com") {
    return parsed.pathname === "/watch" || parsed.pathname.startsWith("/shorts/");
  }
  return false;
}

async function fetchAndCleanVideo(url: string, getTranscript: TranscriptProvider["getTranscript"]): Promise<CleanedContent> {
  const transcript = await getTranscript(url);
  if (!transcript || transcript.segments.length === 0) {
    console.warn(`[extraction] No transcript available for video ${url}`);
    return emptyResult("video");
  }

  const text = transcript.segments.map((s) => s.text).join(" ");
  const extractionConfidence = scoreConfidence(text, transcript.title);
  if (extractionConfidence === 0) {
    console.warn(`[extraction] Video transcript for ${url} was too short to be usable`);
    return emptyResult("video");
  }

  return {
    text,
    title: transcript.title,
    extractionConfidence,
    sourceType: "video",
    chunks: transcript.segments.map((s) => ({ text: s.text, locator: { type: "timestamp", value: s.timestamp } })),
    maxLocatorValue: transcript.totalDurationSeconds,
  };
}

async function fetchAndCleanPdfResponse(response: Response, parsePdf: ParsePdfFn): Promise<CleanedContent> {
  let buffer: ArrayBuffer;
  try {
    buffer = await response.arrayBuffer();
  } catch (error) {
    console.warn(`[extraction] Failed to read PDF body: ${(error as Error).message}`);
    return emptyResult("unreachable");
  }

  let parsed: Awaited<ReturnType<ParsePdfFn>>;
  try {
    parsed = await parsePdf(buffer);
  } catch (error) {
    console.warn(`[extraction] PDF parsing failed: ${(error as Error).message}`);
    return emptyResult("pdf");
  }

  const text = parsed.text.trim();
  const extractionConfidence = scoreConfidence(text, "");
  if (extractionConfidence === 0) {
    // Includes the scanned/image-only case: real, reachable PDF bytes that parse to near-empty
    // text per page — no OCR here (scope boundary), so this degrades exactly like a thin HTML
    // article does, excluded rather than failing the pipeline.
    console.warn(`[extraction] PDF at produced too little extractable text (${text.length} chars) — likely scanned/image-only, no OCR performed`);
    return emptyResult("pdf");
  }

  return {
    text,
    title: "",
    extractionConfidence,
    sourceType: "pdf",
    chunks: parsed.chunks.map((c) => ({ text: c.text, locator: { type: "page", value: c.pageNumber } })),
    maxLocatorValue: parsed.totalPages,
  };
}

/**
 * Fetches a URL and extracts its main content — article text via Readability.js, or (this
 * phase's addition) real PDF text via `pdf-parse` / a real YouTube transcript via MCP, depending
 * on what the URL/response actually is. This is a lightweight, in-process version of what Phase
 * 3's Material Aggregator later persists/caches — kept as a standalone module with this exact
 * signature (now with an additive, optional-only `options` param) so that phase can extend it
 * rather than replace it; Material Aggregator itself needed ZERO changes for PDF/video support —
 * it already just calls this same function and persists whatever `sourceType` comes back.
 *
 * No Trafilatura fallback in this phase (documented gap, not built) — a
 * low-confidence result is simply excluded from the caller's source set.
 */
export async function fetchAndClean(url: string, options: FetchAndCleanOptions = {}): Promise<CleanedContent> {
  const getTranscript = options.getTranscript ?? getTranscriptDefault;
  const parsePdf = options.parsePdf ?? parsePdfDefault;

  // SSRF guard (src/shared/urlSafety.ts) — checked BEFORE the YouTube-routing branch below, so
  // one check covers all three fetch paths that share this entry point (the main HTTP fetch, the
  // PDF path, which is the same fetch just routed differently after the response comes back, and
  // video URLs, which never reach an HTTP request at all). A rejected URL degrades exactly like an
  // already-unreachable one — a new REASON a source gets excluded, not a new failure mode.
  if (!(await isSafeToFetch(url))) {
    console.warn(`[extraction] Refusing to fetch ${url} — it resolves to a private/reserved network address.`);
    return emptyResult("unreachable");
  }

  if (isYoutubeVideoUrl(url)) {
    return fetchAndCleanVideo(url, getTranscript);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/pdf",
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
    const nonHtmlType = classifyNonHtmlContentType(contentType);
    if (nonHtmlType === "pdf") {
      return fetchAndCleanPdfResponse(response, parsePdf);
    }
    console.warn(`[extraction] Skipping non-HTML content-type "${contentType}" for ${url}`);
    return emptyResult(nonHtmlType);
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
 * Reused as-is for PDF/video text (Deliverables 2/3) — one definition of
 * "usable", not a second heuristic per source type.
 */
function scoreConfidence(text: string, title: string): number {
  if (text.length < MIN_USABLE_TEXT_LENGTH) return 0;
  const lengthScore = Math.min(1, text.length / CONFIDENT_TEXT_LENGTH);
  const titleBonus = title.length > 0 ? 0.05 : 0;
  return Math.round(Math.min(1, lengthScore * 0.95 + titleBonus) * 100) / 100;
}
