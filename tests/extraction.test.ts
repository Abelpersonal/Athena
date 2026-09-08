import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

// The SSRF guard (src/shared/urlSafety.ts) does a REAL DNS lookup before every fetch — mocked here
// so every extraction test that isn't specifically about the guard stays fast/deterministic and
// isolated from a real network dependency, defaulting to a real public address so it never
// interferes with what these tests actually check. Dedicated SSRF tests below override this
// per-case to simulate a private/reserved resolution.
const mockLookup = vi.fn();
vi.mock("node:dns/promises", () => ({
  lookup: (...args: unknown[]) => mockLookup(...args),
}));

const { fetchAndClean } = await import("../src/extraction/fetchAndClean.js");

const originalFetch = global.fetch;

function mockFetchOnce(impl: (...args: unknown[]) => unknown): void {
  global.fetch = vi.fn(impl) as unknown as typeof fetch;
}

describe("fetchAndClean", () => {
  beforeEach(() => {
    mockLookup.mockReset().mockResolvedValue([{ address: "104.20.23.154", family: 4 }]);
  });

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

  describe("PDF extraction (Deliverable 2, mocked parsePdf — never a real PDF fetch/parse in tests)", () => {
    it("extracts real per-page chunks with page locators and positive confidence for a substantive PDF", async () => {
      const pageText =
        "This is a realistic sentence of PDF body prose with enough real words to look like a genuine page. ".repeat(
          20
        );
      mockFetchOnce(
        async () => new Response("%PDF-1.4 binary", { status: 200, headers: { "content-type": "application/pdf" } })
      );

      const parsePdf = vi.fn(async () => ({
        text: `${pageText}\n${pageText}`,
        chunks: [
          { text: pageText, pageNumber: 1 },
          { text: pageText, pageNumber: 2 },
        ],
        totalPages: 2,
      }));

      const result = await fetchAndClean("https://example.com/paper.pdf", { parsePdf });

      expect(parsePdf).toHaveBeenCalledTimes(1);
      expect(result.sourceType).toBe("pdf");
      expect(result.extractionConfidence).toBeGreaterThan(0);
      expect(result.maxLocatorValue).toBe(2);
      expect(result.chunks).toEqual([
        { text: pageText, locator: { type: "page", value: 1 } },
        { text: pageText, locator: { type: "page", value: 2 } },
      ]);
    });

    it("degrades a scanned/image-only PDF (near-zero extractable text) to low confidence, excluded, no OCR", async () => {
      mockFetchOnce(
        async () => new Response("%PDF-1.4 binary", { status: 200, headers: { "content-type": "application/pdf" } })
      );

      // Real, reachable PDF bytes that parse successfully but yield almost no text per page —
      // exactly what a scanned/image-only PDF looks like to pdf-parse without OCR.
      const parsePdf = vi.fn(async () => ({
        text: "  \n  ",
        chunks: [
          { text: " ", pageNumber: 1 },
          { text: " ", pageNumber: 2 },
        ],
        totalPages: 2,
      }));

      const result = await fetchAndClean("https://example.com/scanned.pdf", { parsePdf });

      expect(result.sourceType).toBe("pdf");
      expect(result.extractionConfidence).toBe(0);
      expect(result.chunks).toBeUndefined();
    });

    it("degrades to sourceType pdf, confidence 0 (not a throw) when parsePdf itself throws", async () => {
      mockFetchOnce(
        async () => new Response("%PDF-1.4 binary", { status: 200, headers: { "content-type": "application/pdf" } })
      );
      const parsePdf = vi.fn(async () => {
        throw new Error("corrupt PDF structure");
      });

      const result = await fetchAndClean("https://example.com/corrupt.pdf", { parsePdf });
      expect(result.sourceType).toBe("pdf");
      expect(result.extractionConfidence).toBe(0);
    });
  });

  describe("YouTube video transcript retrieval + URL-routing fix (Deliverable 3, mocked getTranscript)", () => {
    const realisticSegments = Array.from({ length: 15 }, (_, i) => ({
      timestamp: `${i}:00`,
      text: "Realistic caption text describing the video content in enough detail to be usable. ",
    }));

    it("routes a youtube.com/watch URL to the transcript adapter WITHOUT ever calling fetch (Readability's path is not taken)", async () => {
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy as unknown as typeof fetch;

      const getTranscript = vi.fn(async () => ({
        title: "A Real Video Title",
        segments: realisticSegments,
        totalDurationSeconds: 930,
      }));

      const result = await fetchAndClean("https://www.youtube.com/watch?v=abc123", { getTranscript });

      expect(getTranscript).toHaveBeenCalledExactlyOnceWith("https://www.youtube.com/watch?v=abc123");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.sourceType).toBe("video");
      expect(result.extractionConfidence).toBeGreaterThan(0);
      expect(result.title).toBe("A Real Video Title");
      expect(result.maxLocatorValue).toBe(930);
      expect(result.chunks).toHaveLength(realisticSegments.length);
      expect(result.chunks![0]).toEqual({
        text: realisticSegments[0]!.text,
        locator: { type: "timestamp", value: "0:00" },
      });
    });

    it("also routes youtu.be/ short links and /shorts/ paths to the transcript adapter", async () => {
      const getTranscript = vi.fn(async () => ({
        title: "Short Link Video",
        segments: realisticSegments,
        totalDurationSeconds: 930,
      }));

      const shortLinkResult = await fetchAndClean("https://youtu.be/abc123", { getTranscript });
      const shortsResult = await fetchAndClean("https://www.youtube.com/shorts/abc123", { getTranscript });

      expect(getTranscript).toHaveBeenCalledTimes(2);
      expect(shortLinkResult.sourceType).toBe("video");
      expect(shortsResult.sourceType).toBe("video");
    });

    it("does NOT route a non-video HTML URL to the transcript adapter", async () => {
      const getTranscript = vi.fn();
      mockFetchOnce(
        async () => new Response("<html><body><article><p>Not a video page.</p></article></body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        })
      );

      await fetchAndClean("https://example.com/article", { getTranscript });
      expect(getTranscript).not.toHaveBeenCalled();
    });

    it("returns extractionConfidence 0 and sourceType video (not a throw) when no transcript/captions are available", async () => {
      const getTranscript = vi.fn(async () => null);
      const result = await fetchAndClean("https://www.youtube.com/watch?v=nocaptions", { getTranscript });
      expect(result.sourceType).toBe("video");
      expect(result.extractionConfidence).toBe(0);
    });
  });

  describe("SSRF guard (mocked DNS)", () => {
    it("refuses to fetch a URL resolving to a private address — no HTTP request is ever made", async () => {
      mockLookup.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy as unknown as typeof fetch;

      const result = await fetchAndClean("http://totally-normal-looking-domain.com/article");

      expect(result).toEqual({ text: "", title: "", extractionConfidence: 0, sourceType: "unreachable" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("this is the DNS-rebinding case: a hostname NOT literally 'localhost' that resolves to a private address is still refused", async () => {
      mockLookup.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]); // cloud metadata
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy as unknown as typeof fetch;

      const result = await fetchAndClean("http://looks-like-a-real-blog.com/post");

      expect(result.sourceType).toBe("unreachable");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("also blocks a spoofed YouTube-looking hostname that resolves privately — checked before the video-routing branch", async () => {
      mockLookup.mockResolvedValueOnce([{ address: "192.168.1.1", family: 4 }]);
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy as unknown as typeof fetch;
      const getTranscript = vi.fn();

      const result = await fetchAndClean("https://www.youtube.com/watch?v=abc123", { getTranscript });

      expect(result.sourceType).toBe("unreachable");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(getTranscript).not.toHaveBeenCalled();
    });

    it("still fetches normally when DNS resolves only to public addresses", async () => {
      mockLookup.mockResolvedValueOnce([{ address: "104.20.23.154", family: 4 }]);
      mockFetchOnce(
        async () => new Response("not found", { status: 404, headers: { "content-type": "text/html" } })
      );

      const result = await fetchAndClean("https://example.com/missing");
      expect(result.sourceType).toBe("unreachable"); // the 404, not the SSRF guard, is why — proves the guard let it through
    });
  });
});

describe("fetchAndClean SSRF guard (real, non-mocked DNS)", () => {
  afterEach(() => {
    vi.doUnmock("node:dns/promises");
    vi.resetModules();
  });

  it("a real (non-mocked) safe public URL still fetches successfully end to end — the guard doesn't reject legitimate sources", async () => {
    vi.doUnmock("node:dns/promises");
    vi.resetModules();
    const { fetchAndClean: realFetchAndClean } = await import("../src/extraction/fetchAndClean.js");

    // A real, unmocked fetch against IANA's own stable reserved example domain — real DNS AND
    // real HTTP, proving the guard's real resolution path doesn't false-positive on a genuine
    // public source.
    const result = await realFetchAndClean("https://example.com/");
    expect(result.sourceType).not.toBe("unreachable");
  });

  it("a real (non-mocked) DNS resolution to the literal loopback address is genuinely refused end to end", async () => {
    vi.doUnmock("node:dns/promises");
    vi.resetModules();
    const { fetchAndClean: realFetchAndClean } = await import("../src/extraction/fetchAndClean.js");

    const result = await realFetchAndClean("http://127.0.0.1:1/should-never-be-fetched");
    expect(result).toEqual({ text: "", title: "", extractionConfidence: 0, sourceType: "unreachable" });
  });
});
