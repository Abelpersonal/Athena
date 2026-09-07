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

const { YoutubeTranscriptMCPProvider } = await import("../src/mcp/youtubeTranscript.js");

// The real, confirmed shape of @sinco-lab/mcp-youtube-transcript@0.0.12's get_timed_transcript
// response (read from its actual published, compiled source — not guessed): one text block
// "# {title}\n\n[HH:MM:SS.mmm] caption" per line, plus a _meta object with title/totalDuration.
function realTimedTranscriptBlock(overrides?: { totalDuration?: number; title?: string }) {
  return {
    type: "text",
    text: [
      "# How Photosynthesis Actually Works",
      "",
      "[00:00:00.000] Welcome back to the channel.",
      "[00:00:04.320] Today we're covering photosynthesis.",
      "[01:04:32.500] And that brings us to the light-independent reactions.",
    ].join("\n"),
    _meta: {
      title: overrides?.title ?? "How Photosynthesis Actually Works",
      totalDuration: overrides?.totalDuration ?? 3900,
    },
  };
}

describe("YoutubeTranscriptMCPProvider", () => {
  beforeEach(() => {
    mockConnect.mockClear();
    mockCallTool.mockReset();
    mockClose.mockClear();
  });

  it("parses a real get_timed_transcript response into natural-format timestamped segments", async () => {
    mockCallTool.mockResolvedValueOnce({
      isError: false,
      content: [realTimedTranscriptBlock()],
    });

    const provider = new YoutubeTranscriptMCPProvider();
    const result = await provider.getTranscript("https://www.youtube.com/watch?v=abc123");

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("How Photosynthesis Actually Works");
    expect(result!.totalDurationSeconds).toBe(3900);
    // The first two raw caption lines (0:00, 0:04) are both within one 180s window and merge into
    // a single segment; the 01:04:32 line is far outside that window and starts a new one.
    expect(result!.segments).toEqual([
      { timestamp: "0:00", text: "Welcome back to the channel. Today we're covering photosynthesis." },
      { timestamp: "1:04:32", text: "And that brings us to the light-independent reactions." },
    ]);
  });

  it("groups raw caption lines into ~3-minute windows rather than one excerpt per raw line", async () => {
    const text = [
      "# A Long Video",
      "",
      "[00:00:00.000] Line at zero seconds.",
      "[00:01:00.000] Line at one minute.",
      "[00:02:59.000] Line just under three minutes.",
      "[00:03:01.000] Line just past three minutes — starts a new window.",
      "[00:05:00.000] Line at five minutes — still in the second window.",
      "[00:06:30.000] Line at six and a half minutes — starts a third window.",
    ].join("\n");

    mockCallTool.mockResolvedValueOnce({
      isError: false,
      content: [{ type: "text", text, _meta: { title: "A Long Video", totalDuration: 400 } }],
    });

    const provider = new YoutubeTranscriptMCPProvider();
    const result = await provider.getTranscript("https://www.youtube.com/watch?v=long");

    expect(result!.segments).toEqual([
      { timestamp: "0:00", text: "Line at zero seconds. Line at one minute. Line just under three minutes." },
      {
        timestamp: "3:01",
        text: "Line just past three minutes — starts a new window. Line at five minutes — still in the second window.",
      },
      { timestamp: "6:30", text: "Line at six and a half minutes — starts a third window." },
    ]);
  });

  it("calls the tool named get_timed_transcript (not get_transcripts) with the video URL", async () => {
    mockCallTool.mockResolvedValueOnce({ isError: false, content: [realTimedTranscriptBlock()] });

    const provider = new YoutubeTranscriptMCPProvider();
    await provider.getTranscript("https://www.youtube.com/watch?v=abc123");

    expect(mockCallTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "get_timed_transcript",
        arguments: { url: "https://www.youtube.com/watch?v=abc123" },
      })
    );
  });

  it("falls back to the last real caption's own timestamp when _meta.totalDuration is missing", async () => {
    const block = realTimedTranscriptBlock();
    delete (block._meta as { totalDuration?: number }).totalDuration;
    mockCallTool.mockResolvedValueOnce({ isError: false, content: [block] });

    const provider = new YoutubeTranscriptMCPProvider();
    const result = await provider.getTranscript("https://www.youtube.com/watch?v=abc123");

    // Last caption is at 01:04:32 -> 3872 real observed seconds, a real fallback bound, never a guess.
    expect(result!.totalDurationSeconds).toBe(3872);
  });

  it("returns null (not a throw) when the tool call rejects", async () => {
    mockCallTool.mockRejectedValueOnce(new Error("network down"));

    const provider = new YoutubeTranscriptMCPProvider();
    const result = await provider.getTranscript("https://www.youtube.com/watch?v=abc123");

    expect(result).toBeNull();
  });

  it("returns null when the MCP server reports a tool-level error (e.g. captions disabled)", async () => {
    mockCallTool.mockResolvedValueOnce({
      isError: true,
      content: [{ type: "text", text: "No captions available for this video" }],
    });

    const provider = new YoutubeTranscriptMCPProvider();
    const result = await provider.getTranscript("https://www.youtube.com/watch?v=abc123");

    expect(result).toBeNull();
  });

  it("returns null when the response has no parseable timestamped lines", async () => {
    mockCallTool.mockResolvedValueOnce({
      isError: false,
      content: [{ type: "text", text: "# A Video\n\nNo timed lines here, just prose.", _meta: {} }],
    });

    const provider = new YoutubeTranscriptMCPProvider();
    const result = await provider.getTranscript("https://www.youtube.com/watch?v=abc123");

    expect(result).toBeNull();
  });
});
