import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchAndClean } from "../src/extraction/fetchAndClean.js";

const originalFetch = global.fetch;

function mockFetchOnce(impl: (...args: unknown[]) => unknown): void {
  global.fetch = vi.fn(impl) as unknown as typeof fetch;
}

describe("fetchAndClean", () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns extractionConfidence 0 and sourceType unreachable (not a throw) when the fetch itself fails", async () => {
    mockFetchOnce(async () => {
      throw new Error("network down");
    });

    const result = await fetchAndClean("https://example.com/a");
    expect(result).toEqual({ text: "", title: "", extractionConfidence: 0, sourceType: "unreachable" });
  });

  it("returns extractionConfidence 0 and sourceType unreachable for a non-2xx response", async () => {
    mockFetchOnce(
      async () => new Response("not found", { status: 404, headers: { "content-type": "text/html" } })
    );

    const result = await fetchAndClean("https://example.com/missing");
    expect(result.extractionConfidence).toBe(0);
    expect(result.sourceType).toBe("unreachable");
  });

  it("returns extractionConfidence 0 and sourceType pdf for a PDF content type", async () => {
    mockFetchOnce(
      async () => new Response("%PDF-1.4 binary", { status: 200, headers: { "content-type": "application/pdf" } })
    );

    const result = await fetchAndClean("https://example.com/file.pdf");
    expect(result.extractionConfidence).toBe(0);
    expect(result.sourceType).toBe("pdf");
  });

  it("returns sourceType video for a video content type", async () => {
    mockFetchOnce(
      async () => new Response("binary", { status: 200, headers: { "content-type": "video/mp4" } })
    );

    const result = await fetchAndClean("https://example.com/clip.mp4");
    expect(result.sourceType).toBe("video");
  });

  it("returns sourceType other for a non-HTML, non-pdf, non-video content type", async () => {
    mockFetchOnce(
      async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    );

    const result = await fetchAndClean("https://example.com/data.json");
    expect(result.sourceType).toBe("other");
  });

  it("returns sourceType low_confidence when Readability finds no article content in real HTML", async () => {
    mockFetchOnce(
      async () => new Response("<html><body><div id=\"app\"></div></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );

    const result = await fetchAndClean("https://example.com/spa");
    expect(result.extractionConfidence).toBe(0);
    expect(result.sourceType).toBe("low_confidence");
  });

  it("extracts real article text with positive confidence for a substantive article", async () => {
    const paragraph =
      "This is a realistic sentence of article prose with enough real words to look like a genuine paragraph. ".repeat(
        30
      );
    const html = `<!DOCTYPE html><html><head><title>Test Article</title></head><body>
      <article>
        <h1>Test Article</h1>
        <p>${paragraph}</p>
        <p>${paragraph}</p>
      </article>
    </body></html>`;
    mockFetchOnce(
      async () => new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })
    );

    const result = await fetchAndClean("https://example.com/article");
    expect(result.extractionConfidence).toBeGreaterThan(0);
    expect(result.text.length).toBeGreaterThan(500);
    expect(result.title.length).toBeGreaterThan(0);
    expect(result.sourceType).toBe("article");
  });

  it("returns extractionConfidence 0 and sourceType low_confidence when the page has too little extractable text", async () => {
    const html = `<!DOCTYPE html><html><head><title>Thin</title></head><body><p>Too short.</p></body></html>`;
    mockFetchOnce(async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } }));

    const result = await fetchAndClean("https://example.com/thin");
    expect(result.extractionConfidence).toBe(0);
    expect(result.sourceType).toBe("low_confidence");
  });

  it("confidence increases with extracted text length, capped at 1", async () => {
    const shortHtml = `<!DOCTYPE html><html><head><title>Short</title></head><body><article><p>${"Real article sentence. ".repeat(
      40
    )}</p></article></body></html>`;
    const longHtml = `<!DOCTYPE html><html><head><title>Long</title></head><body><article><p>${"Real article sentence. ".repeat(
      400
    )}</p></article></body></html>`;

    mockFetchOnce(
      async () => new Response(shortHtml, { status: 200, headers: { "content-type": "text/html" } })
    );
    const shortResult = await fetchAndClean("https://example.com/short");

    mockFetchOnce(async () => new Response(longHtml, { status: 200, headers: { "content-type": "text/html" } }));
    const longResult = await fetchAndClean("https://example.com/long");

    expect(longResult.extractionConfidence).toBeGreaterThanOrEqual(shortResult.extractionConfidence);
    expect(longResult.extractionConfidence).toBeLessThanOrEqual(1);
  });
});
