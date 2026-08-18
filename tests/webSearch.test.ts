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

  it("skips non-JSON text content instead of fabricating a result", async () => {
    mockCallTool.mockResolvedValueOnce({
      isError: false,
      content: [{ type: "text", text: "not json, just prose" }],
    });

    const provider = new TavilyMCPSearchProvider({ apiKey: "test-key" });
    const results = await provider.search(["anything"]);

    expect(results).toEqual([]);
  });
});
