import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockCallTool = vi.fn();
const mockClose = vi.fn().mockResolvedValue(undefined);

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(function MockClient() {
    return {
      connect: mockConnect,
      callTool: mockCallTool,
      close: mockClose,
    };
  }),
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn().mockImplementation(function MockStdioClientTransport() {
    return {};
  }),
}));

const { TavilyMCPSearchProvider } = await import("../src/mcp/webSearch.js");

describe("TavilyMCPSearchProvider", () => {
  beforeEach(() => {
    mockConnect.mockClear();
    mockCallTool.mockReset();
    mockClose.mockClear();
  });

  it("parses a Tavily search response into SearchResult[]", async () => {
    mockCallTool.mockResolvedValueOnce({
      isError: false,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            results: [
              { title: "Example", url: "https://example.com/a", content: "Snippet A", score: 0.9 },
              { url: "https://example.com/b", content: "No title here" },
            ],
          }),
        },
      ],
    });

    const provider = new TavilyMCPSearchProvider({ apiKey: "test-key" });
    const results = await provider.search(["example query"]);

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      url: "https://example.com/a",
      title: "Example",
      snippet: "Snippet A",
      query: "example query",
    });
    expect(results[0]!.source_id).toMatch(/^src_[0-9a-f]{12}$/);
    // Missing title falls back to the URL rather than being dropped.
    expect(results[1]!.title).toBe("https://example.com/b");
  });

  it("returns an empty array (not a throw) when the tool call rejects", async () => {
    mockCallTool.mockRejectedValueOnce(new Error("network down"));

    const provider = new TavilyMCPSearchProvider({ apiKey: "test-key" });
    const results = await provider.search(["anything"]);

    expect(results).toEqual([]);
  });

  it("returns an empty array when the MCP server reports a tool-level error", async () => {
    mockCallTool.mockResolvedValueOnce({
      isError: true,
      content: [{ type: "text", text: "boom" }],
    });

    const provider = new TavilyMCPSearchProvider({ apiKey: "test-key" });
    const results = await provider.search(["anything"]);

    expect(results).toEqual([]);
  });

  it("returns an empty array for an empty query list without connecting", async () => {
    const provider = new TavilyMCPSearchProvider({ apiKey: "test-key" });
    const results = await provider.search([]);

    expect(results).toEqual([]);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("skips unstructured prose (neither JSON nor the Detailed Results text shape) instead of fabricating a result, and logs a diagnostic warning", async () => {
    mockCallTool.mockResolvedValueOnce({
      isError: false,
      content: [{ type: "text", text: "not json, just prose" }],
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const provider = new TavilyMCPSearchProvider({ apiKey: "test-key" });
    const results = await provider.search(["anything"]);

    expect(results).toEqual([]);
    expect(warnSpy.mock.calls.some(([msg]) => typeof msg === "string" && msg.includes("matching neither the JSON"))).toBe(true);
    warnSpy.mockRestore();
  });

  it("does NOT warn on a genuinely empty JSON results array (a real, valid zero-hits response)", async () => {
    mockCallTool.mockResolvedValueOnce({
      isError: false,
      content: [{ type: "text", text: JSON.stringify({ results: [] }) }],
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const provider = new TavilyMCPSearchProvider({ apiKey: "test-key" });
    const results = await provider.search(["a query with genuinely no hits"]);

    expect(results).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("degrades gracefully (empty results, logged, no crash) on a real keyless rate-limit/usage-cap response", async () => {
    // SSRF/Idempotency-adjacent follow-up: TAVILY_API_KEY missing is a legitimate, working free
    // "keyless mode" (confirmed directly by reading the real tavily-mcp@0.2.22 package source),
    // not a misconfiguration. The one real, verified functional difference: a keyless rate-limit
    // hit does NOT come back as an MCP tool-level error (isError: true) — the server's own
    // `isKeylessEnvelope`/`formatKeylessEnvelope` functions catch it and return a normal text
    // block instead, in exactly this shape (a message, an optional "Retry after: Ns" line, and a
    // "Continuation options:" list with a sign-up link) — reproduced here verbatim from that
    // confirmed real source, not guessed, since a real rate-limit hit wasn't triggered by 15 rapid
    // real requests during manual verification (see README).
    const keylessRateLimitText = [
      "Usage limit reached for keyless access. Try again later or use an API key for a higher limit.",
      "Retry after: 3600s",
      "",
      "Continuation options:",
      "- Sign up for a Tavily API key: https://app.tavily.com/",
    ].join("\n");
    mockCallTool.mockResolvedValueOnce({
      isError: false,
      content: [{ type: "text", text: keylessRateLimitText }],
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const provider = new TavilyMCPSearchProvider({}); // no apiKey — keyless mode
    const results = await provider.search(["anything"]);

    expect(results).toEqual([]); // degrades exactly like any other search failure — never throws
    expect(warnSpy.mock.calls.some(([msg]) => typeof msg === "string" && msg.includes("Usage limit reached"))).toBe(true);
    warnSpy.mockRestore();
  });

  it("parses the real tavily_search plain-text response shape (Title:/ID:/URL:/Content: blocks)", async () => {
    // Confirmed live against the real tavily-mcp package — the actual
    // response is plain text, not JSON, and Phase 1's original JSON-only
    // parser silently dropped every real result because of it.
    const text = [
      "Detailed Results:",
      "",
      "Title: Photosynthesis",
      "ID: 5d4967-00",
      "URL: https://en.wikipedia.org/wiki/Photosynthesis",
      "Content: Photosynthesis is the process by which plants convert light into",
      "chemical energy, spanning multiple lines of content.",
      "",
      "Title: Photosynthesis - PMC - NIH",
      "ID: b36053-01",
      "URL: https://pmc.ncbi.nlm.nih.gov/articles/PMC5264509",
      "Content: Photosynthesis is the ultimate source of food and oxygen.",
    ].join("\n");

    mockCallTool.mockResolvedValueOnce({
      isError: false,
      content: [{ type: "text", text }],
    });

    const provider = new TavilyMCPSearchProvider({ apiKey: "test-key" });
    const results = await provider.search(["photosynthesis"]);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      url: "https://en.wikipedia.org/wiki/Photosynthesis",
      title: "Photosynthesis",
    });
    expect(results[0]!.snippet).toContain("chemical energy, spanning multiple lines");
    expect(results[1]).toMatchObject({
      url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5264509",
      title: "Photosynthesis - PMC - NIH",
    });
  });

  it("calls the tool named tavily_search (not tavily-search)", async () => {
    mockCallTool.mockResolvedValueOnce({ isError: false, content: [] });

    const provider = new TavilyMCPSearchProvider({ apiKey: "test-key" });
    await provider.search(["anything"]);

    expect(mockCallTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "tavily_search" }),
      undefined,
      expect.objectContaining({ timeout: expect.any(Number), signal: expect.any(AbortSignal) })
    );
  });

  it("passes a real timeout + AbortSignal through to callTool's RequestOptions", async () => {
    mockCallTool.mockResolvedValueOnce({ isError: false, content: [] });

    const provider = new TavilyMCPSearchProvider({ apiKey: "test-key" });
    await provider.search(["anything"]);

    const [, resultSchema, options] = mockCallTool.mock.calls[0]!;
    expect(resultSchema).toBeUndefined();
    expect(typeof options.timeout).toBe("number");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.signal.aborted).toBe(false);
  });

  describe("timeout (Timeouts + Hard Cost Cap, Deliverable 1)", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("degrades to an empty result (not hanging forever) with a distinguishable timeout warning, when the MCP server never responds", async () => {
      mockCallTool.mockImplementation(() => new Promise(() => {})); // simulates a genuine hang
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const provider = new TavilyMCPSearchProvider({ apiKey: "test-key" });
      const resultPromise = provider.search(["anything"]);
      const assertion = expect(resultPromise).resolves.toEqual([]); // searchOne's own catch degrades a timeout the same as any other failure
      await vi.advanceTimersByTimeAsync(30_000);
      await assertion;

      expect(warnSpy.mock.calls.some(([msg]) => typeof msg === "string" && msg.includes("timed out"))).toBe(true);
      warnSpy.mockRestore();
    });
  });
});
