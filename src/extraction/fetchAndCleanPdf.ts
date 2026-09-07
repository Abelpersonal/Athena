import { PDFParse } from "pdf-parse";

export interface PdfChunk {
  text: string;
  pageNumber: number;
}

export interface ParsedPdfResult {
  text: string;
  /** One chunk per page (a real page's real text) — never split further and never grouped, since PDF page counts in the topics this project researches (papers, reports) are small enough that per-page is already a reasonable prompt-chunking granularity; see README for the "why per-page, not page groups" call. */
  chunks: PdfChunk[];
  /** The document's real total page count (`pdf-parse`'s own `TextResult.total`) — the known bound the locator sanity check (src/research/grounding.ts) compares a cited page number against. */
  totalPages: number;
}

export type ParsePdfFn = (data: ArrayBuffer) => Promise<ParsedPdfResult>;

/**
 * Real PDF text extraction via `pdf-parse` v2's `PDFParse` class API (confirmed against the
 * actual installed package — a hand-built, real, valid multi-page PDF was parsed successfully
 * during development; see the README for what that confirmed). `getText()` with no `partial`
 * option returns every page's text plus the real total page count in one call — no second call
 * needed to also get per-page text, unlike Deliverable 3's video path (which needs the MCP
 * server's own single call to return timestamped segments directly).
 *
 * A scanned/image-only PDF is real, reachable, valid PDF bytes that simply parse to near-empty
 * text per page — `fetchAndClean.ts`'s caller applies the SAME confidence heuristic used for a
 * thin HTML article (`MIN_USABLE_TEXT_LENGTH`) to this function's combined text, so that case
 * degrades to `emptyResult("pdf")`/low confidence exactly like today's `low_confidence` article
 * path, not a special case here. No OCR — this only ever extracts text embedded in the PDF
 * itself, per the kickoff's own scope boundary.
 */
export async function parsePdf(data: ArrayBuffer): Promise<ParsedPdfResult> {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return {
      text: result.text,
      chunks: result.pages.map((p) => ({ text: p.text, pageNumber: p.num })),
      totalPages: result.total,
    };
  } finally {
    await parser.destroy();
  }
}
