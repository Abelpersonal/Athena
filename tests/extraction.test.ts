import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";

// The SSRF guard (src/shared/urlSafety.ts) does a REAL DNS lookup before every fetch — mocked here
// so every extraction test that isn't specifically about the guard stays fast/deterministic and
// isolated from a real network dependency, defaulting to a real public address so it never
// interferes with what these tests actually check. Dedicated SSRF tests below override this
// per-case to simulate a private/reserved resolution.
const mockLookup = vi.fn();
vi.mock("node:dns/promises", () => ({
  lookup: (...args: unknown[]) => mockLookup(...args),
}));

// fetchAndClean.ts uses node:http/node:https directly (never fetch()/undici) — see its own doc
// comment for the real, live-confirmed reasons (undici's hardcoded 300s default headersTimeout
// escaping this module's own, much shorter AbortController-based timeout). Mocked here the same
// way tests/providers.test.ts mocks OllamaProvider's identical node:http/https usage.
const mockHttpRequest = vi.fn();
vi.mock("node:http", () => ({ default: { request: (...args: unknown[]) => mockHttpRequest(...args) } }));
vi.mock("node:https", () => ({ default: { request: (...args: unknown[]) => mockHttpRequest(...args) } }));

const { fetchAndClean } = await import("../src/extraction/fetchAndClean.js");

interface CapturedRequest {
  url: URL;
  options: Record<string, unknown>;
}
let capturedRequests: CapturedRequest[] = [];

/**
 * Fakes one `http.request`/`https.request` round trip — a request object (write/end, both no-ops
 * here since this is always a GET with no body) and, once `.end()` is called, invokes the real
 * request callback with a response object (a real `EventEmitter`, matching Node's own
 * `IncomingMessage`) emitting the given status/headers/body.
 */
function httpImpl(status: number, headers: Record<string, string>, body: string | Buffer) {
  return (url: URL, options: Record<string, unknown>, callback: (res: EventEmitter & { statusCode: number; headers: Record<string, string> }) => void) => {
    capturedRequests.push({ url, options });
    const req = new EventEmitter() as EventEmitter & { write: (chunk: unknown) => void; end: () => void };
    req.write = vi.fn();
    req.end = vi.fn(() => {
      const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string> };
      res.statusCode = status;
      res.headers = headers;
      callback(res);
      res.emit("data", typeof body === "string" ? Buffer.from(body) : body);
      res.emit("end");
    });
    return req;
  };
}

/** Matches the old `mockFetchOnce`'s role: sets up exactly one full request/response cycle. */
function mockHttpOnce(status: number, headers: Record<string, string>, body: string | Buffer): void {
  mockHttpRequest.mockImplementationOnce(httpImpl(status, headers, body));
}

/** A request whose underlying transport itself fails (DNS/connection-refused/etc equivalent) — never reaches a response at all. */
function mockHttpErrorOnce(error: Error): void {
  mockHttpRequest.mockImplementationOnce(() => {
    const req = new EventEmitter() as EventEmitter & { write: (chunk: unknown) => void; end: () => void };
    req.write = vi.fn();
    req.end = vi.fn(() => {
      req.emit("error", error);
    });
    return req;
  });
}

/**
 * A request that never calls back on its own — the real shape of the exact bug this rewrite
 * fixes (a server that accepts the connection but never responds). Listens for the passed
 * AbortSignal and emits `'error'` on abort, matching Node's own real, documented behavior for
 * `http.request(url, { signal })` (destroying the request and emitting an error when the signal
 * fires) — without this, the mock wouldn't reproduce what actually makes this function's own
 * timeout work, and the test would prove nothing.
 */
function mockHttpHangForever(): void {
  mockHttpRequest.mockImplementationOnce((_url: URL, options: Record<string, unknown>) => {
    const req = new EventEmitter() as EventEmitter & { write: (chunk: unknown) => void; end: () => void };
    req.write = vi.fn();
    req.end = vi.fn();
    (options.signal as AbortSignal | undefined)?.addEventListener("abort", () => {
      req.emit("error", new Error("The operation was aborted."));
    });
    return req;
  });
}

describe("fetchAndClean", () => {
  beforeEach(() => {
    mockLookup.mockReset().mockResolvedValue([{ address: "104.20.23.154", family: 4 }]);
    mockHttpRequest.mockReset();
    capturedRequests = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns extractionConfidence 0 and sourceType unreachable (not a throw) when the connection itself fails", async () => {
    mockHttpErrorOnce(new Error("network down"));

    const result = await fetchAndClean("https://example.com/a");
    expect(result).toEqual({ text: "", title: "", extractionConfidence: 0, sourceType: "unreachable" });
  });

  it("returns extractionConfidence 0 and sourceType unreachable for a non-2xx response", async () => {
    mockHttpOnce(404, { "content-type": "text/html" }, "not found");

    const result = await fetchAndClean("https://example.com/missing");
    expect(result.extractionConfidence).toBe(0);
    expect(result.sourceType).toBe("unreachable");
  });

  it("returns extractionConfidence 0 and sourceType pdf for a PDF content type", async () => {
    mockHttpOnce(200, { "content-type": "application/pdf" }, "%PDF-1.4 binary");

    const result = await fetchAndClean("https://example.com/file.pdf");
    expect(result.extractionConfidence).toBe(0);
    expect(result.sourceType).toBe("pdf");
  });

  it("returns sourceType video for a video content type", async () => {
    mockHttpOnce(200, { "content-type": "video/mp4" }, "binary");

    const result = await fetchAndClean("https://example.com/clip.mp4");
    expect(result.sourceType).toBe("video");
  });

  it("returns sourceType other for a non-HTML, non-pdf, non-video content type", async () => {
    mockHttpOnce(200, { "content-type": "application/json" }, "{}");

    const result = await fetchAndClean("https://example.com/data.json");
    expect(result.sourceType).toBe("other");
  });

  it("returns sourceType low_confidence when Readability finds no article content in real HTML", async () => {
    mockHttpOnce(200, { "content-type": "text/html" }, '<html><body><div id="app"></div></body></html>');

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
    mockHttpOnce(200, { "content-type": "text/html; charset=utf-8" }, html);

    const result = await fetchAndClean("https://example.com/article");
    expect(result.extractionConfidence).toBeGreaterThan(0);
    expect(result.text.length).toBeGreaterThan(500);
    expect(result.title.length).toBeGreaterThan(0);
    expect(result.sourceType).toBe("article");
  });

  it("returns extractionConfidence 0 and sourceType low_confidence when the page has too little extractable text", async () => {
    const html = `<!DOCTYPE html><html><head><title>Thin</title></head><body><p>Too short.</p></body></html>`;
    mockHttpOnce(200, { "content-type": "text/html" }, html);

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

    mockHttpOnce(200, { "content-type": "text/html" }, shortHtml);
    const shortResult = await fetchAndClean("https://example.com/short");

    mockHttpOnce(200, { "content-type": "text/html" }, longHtml);
    const longResult = await fetchAndClean("https://example.com/long");

    expect(longResult.extractionConfidence).toBeGreaterThanOrEqual(shortResult.extractionConfidence);
    expect(longResult.extractionConfidence).toBeLessThanOrEqual(1);
  });

  describe("redirects (node:http/https don't follow automatically — fetchAndClean.ts follows manually)", () => {
    it("follows a 302 redirect to its final destination and extracts content from there", async () => {
      mockHttpOnce(302, { location: "https://example.com/final" }, "");
      const html = `<!DOCTYPE html><html><head><title>Final</title></head><body><article><p>${"Real content after redirect. ".repeat(
        30
      )}</p></article></body></html>`;
      mockHttpOnce(200, { "content-type": "text/html" }, html);

      const result = await fetchAndClean("https://example.com/initial");

      expect(mockHttpRequest).toHaveBeenCalledTimes(2);
      expect(capturedRequests[0]!.url.toString()).toBe("https://example.com/initial");
      expect(capturedRequests[1]!.url.toString()).toBe("https://example.com/final");
      expect(result.sourceType).toBe("article");
      expect(result.extractionConfidence).toBeGreaterThan(0);
    });

    it("resolves a relative Location header against the redirecting URL", async () => {
      mockHttpOnce(301, { location: "/moved" }, "");
      mockHttpOnce(200, { "content-type": "text/html" }, "<html><body><article><p>x</p></article></body></html>");

      await fetchAndClean("https://example.com/old-path");

      expect(capturedRequests[1]!.url.toString()).toBe("https://example.com/moved");
    });

    it("gives up and reports unreachable after exceeding the redirect limit, rather than looping forever", async () => {
      for (let i = 0; i < 12; i++) {
        mockHttpRequest.mockImplementationOnce(httpImpl(302, { location: `https://example.com/hop-${i + 1}` }, ""));
      }

      const result = await fetchAndClean("https://example.com/hop-0");
      expect(result.sourceType).toBe("unreachable");
    });

    it("re-checks the SSRF guard on every redirect target, refusing a redirect into a private address", async () => {
      mockLookup.mockReset();
      mockLookup.mockResolvedValueOnce([{ address: "104.20.23.154", family: 4 }]); // the initial URL: public, allowed
      mockLookup.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]); // the redirect target: cloud metadata

      mockHttpOnce(302, { location: "https://internal-looking-but-not.example.com/secrets" }, "");

      const result = await fetchAndClean("https://example.com/redirector");

      expect(result.sourceType).toBe("unreachable");
      // Only the first (safe) hop actually reached the network — the redirect target was refused
      // before a second request was ever made.
      expect(mockHttpRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe("PDF extraction (Deliverable 2, mocked parsePdf — never a real PDF fetch/parse in tests)", () => {
    it("extracts real per-page chunks with page locators and positive confidence for a substantive PDF", async () => {
      const pageText =
        "This is a realistic sentence of PDF body prose with enough real words to look like a genuine page. ".repeat(
          20
        );
      mockHttpOnce(200, { "content-type": "application/pdf" }, "%PDF-1.4 binary");

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
      mockHttpOnce(200, { "content-type": "application/pdf" }, "%PDF-1.4 binary");

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
      mockHttpOnce(200, { "content-type": "application/pdf" }, "%PDF-1.4 binary");
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

    it("routes a youtube.com/watch URL to the transcript adapter WITHOUT ever making an HTTP request (Readability's path is not taken)", async () => {
      const getTranscript = vi.fn(async () => ({
        title: "A Real Video Title",
        segments: realisticSegments,
        totalDurationSeconds: 930,
      }));

      const result = await fetchAndClean("https://www.youtube.com/watch?v=abc123", { getTranscript });

      expect(getTranscript).toHaveBeenCalledExactlyOnceWith("https://www.youtube.com/watch?v=abc123");
      expect(mockHttpRequest).not.toHaveBeenCalled();
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
      mockHttpOnce(200, { "content-type": "text/html" }, "<html><body><article><p>Not a video page.</p></article></body></html>");

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

      const result = await fetchAndClean("http://totally-normal-looking-domain.com/article");

      expect(result).toEqual({ text: "", title: "", extractionConfidence: 0, sourceType: "unreachable" });
      expect(mockHttpRequest).not.toHaveBeenCalled();
    });

    it("this is the DNS-rebinding case: a hostname NOT literally 'localhost' that resolves to a private address is still refused", async () => {
      mockLookup.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]); // cloud metadata

      const result = await fetchAndClean("http://looks-like-a-real-blog.com/post");

      expect(result.sourceType).toBe("unreachable");
      expect(mockHttpRequest).not.toHaveBeenCalled();
    });

    it("also blocks a spoofed YouTube-looking hostname that resolves privately — checked before the video-routing branch", async () => {
      mockLookup.mockResolvedValueOnce([{ address: "192.168.1.1", family: 4 }]);
      const getTranscript = vi.fn();

      const result = await fetchAndClean("https://www.youtube.com/watch?v=abc123", { getTranscript });

      expect(result.sourceType).toBe("unreachable");
      expect(mockHttpRequest).not.toHaveBeenCalled();
      expect(getTranscript).not.toHaveBeenCalled();
    });

    it("still fetches normally when DNS resolves only to public addresses", async () => {
      mockLookup.mockResolvedValueOnce([{ address: "104.20.23.154", family: 4 }]);
      mockHttpOnce(404, { "content-type": "text/html" }, "not found");

      const result = await fetchAndClean("https://example.com/missing");
      expect(result.sourceType).toBe("unreachable"); // the 404, not the SSRF guard, is why — proves the guard let it through
    });
  });

  describe("HeadersTimeoutError leak fix (undici's hidden default timeout, confirmed live in the Ollama provider first)", () => {
    it("degrades to unreachable (not a crash) when the server never responds at all, bounded by this function's own AbortSignal — not a hidden 300s default underneath it", async () => {
      vi.useFakeTimers();
      mockHttpHangForever();

      const resultPromise = fetchAndClean("https://example.com/hangs-forever");
      const assertion = expect(resultPromise).resolves.toEqual({
        text: "",
        title: "",
        extractionConfidence: 0,
        sourceType: "unreachable",
      });
      // FETCH_TIMEOUT_MS is 15s — well short of undici's old hidden 300s default. A request that
      // never emits anything must degrade at THIS boundary, not hang for minutes waiting on a
      // timeout this module no longer has any dependency on.
      await vi.advanceTimersByTimeAsync(15_000);
      await assertion;
    });

    it("aborts the underlying request (passes signal through to node:http/https) rather than just abandoning it", async () => {
      vi.useFakeTimers();
      let capturedSignal: AbortSignal | undefined;
      mockHttpRequest.mockImplementationOnce((_url: URL, options: Record<string, unknown>) => {
        capturedSignal = options.signal as AbortSignal;
        const req = new EventEmitter() as EventEmitter & { write: (chunk: unknown) => void; end: () => void };
        req.write = vi.fn();
        req.end = vi.fn();
        capturedSignal.addEventListener("abort", () => {
          req.emit("error", new Error("The operation was aborted."));
        });
        return req;
      });

      const resultPromise = fetchAndClean("https://example.com/hangs-forever");
      await vi.advanceTimersByTimeAsync(15_000);
      await resultPromise;

      expect(capturedSignal?.aborted).toBe(true);
    });
  });
});

describe("fetchAndClean SSRF guard (real, non-mocked DNS + real node:http/https)", () => {
  afterEach(() => {
    vi.doUnmock("node:dns/promises");
    vi.doUnmock("node:http");
    vi.doUnmock("node:https");
    vi.resetModules();
  });

  it("a real (non-mocked) safe public URL still fetches successfully end to end — the guard doesn't reject legitimate sources", async () => {
    vi.doUnmock("node:dns/promises");
    vi.doUnmock("node:http");
    vi.doUnmock("node:https");
    vi.resetModules();
    const { fetchAndClean: realFetchAndClean } = await import("../src/extraction/fetchAndClean.js");

    // A real, unmocked fetch against IANA's own stable reserved example domain — real DNS AND
    // real HTTP (via the real node:http/https this module now actually uses, not fetch()/undici),
    // proving the guard's real resolution path doesn't false-positive on a genuine public source,
    // and that the node:http/https rewrite itself genuinely fetches a real page end to end.
    const result = await realFetchAndClean("https://example.com/");
    expect(result.sourceType).not.toBe("unreachable");
  });

  it("a real (non-mocked) DNS resolution to the literal loopback address is genuinely refused end to end", async () => {
    vi.doUnmock("node:dns/promises");
    vi.doUnmock("node:http");
    vi.doUnmock("node:https");
    vi.resetModules();
    const { fetchAndClean: realFetchAndClean } = await import("../src/extraction/fetchAndClean.js");

    const result = await realFetchAndClean("http://127.0.0.1:1/should-never-be-fetched");
    expect(result).toEqual({ text: "", title: "", extractionConfidence: 0, sourceType: "unreachable" });
  });
});
