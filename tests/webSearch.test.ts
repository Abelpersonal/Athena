import { describe, it, expect, vi, beforeEach } from "vitest";

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

  it("skips unstructured prose (neither JSON nor the Detailed Results text shape) instead of fabricating a result", async () => {
    mockCallTool.mockResolvedValueOnce({
      isError: false,
      content: [{ type: "text", text: "not json, just prose" }],
    });

    const provider = new TavilyMCPSearchProvider({ apiKey: "test-key" });
    const results = await provider.search(["anything"]);

    expect(results).toEqual([]);
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
      expect.objectContaining({ name: "tavily_search" })
    );
  });
});
