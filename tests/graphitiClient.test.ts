import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockCallTool = vi.fn();
const mockClose = vi.fn().mockResolvedValue(undefined);

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(function MockClient() {
    return { connect: mockConnect, callTool: mockCallTool, close: mockClose };
  }),
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(function MockStreamableHTTPClientTransport() {
    return {};
  }),
}));

const { GraphitiMCPClient } = await import("../src/memoryGraph/graphitiClient.js");
const { writeTopic } = await import("../src/memoryGraph/index.js");

describe("GraphitiMCPClient timeout (Timeouts + Hard Cost Cap, Deliverable 1)", () => {
  beforeEach(() => {
    mockConnect.mockReset().mockResolvedValue(undefined);
    mockCallTool.mockReset();
    mockClose.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("throws a distinguishable timeout error (not hanging forever) when the graph server never responds", async () => {
    mockCallTool.mockImplementation(() => new Promise(() => {})); // simulates a genuine hang

    const client = new GraphitiMCPClient();
    const callPromise = client.callTool("add_memory", { name: "x" });
    const assertion = expect(callPromise).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });

  it("passes a real timeout + AbortSignal through to callTool's RequestOptions", async () => {
    mockCallTool.mockResolvedValueOnce({ isError: false, content: [{ type: "text", text: "{}" }] });

    const client = new GraphitiMCPClient();
    await client.callTool("add_memory", { name: "x" });

    const [, resultSchema, options] = mockCallTool.mock.calls[0]!;
    expect(resultSchema).toBeUndefined();
    expect(typeof options.timeout).toBe("number");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("a hung Memory Graph write still lets course generation proceed: writeTopic() resolves (never throws) and logs the failure", async () => {
    mockCallTool.mockImplementation(() => new Promise(() => {})); // simulates a genuine hang
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const client = new GraphitiMCPClient();
    // Real code path courseBuilder/index.ts's Step 5 calls: this must resolve normally (course
    // generation proceeds) even though the underlying MCP call never responds on its own — this
    // is the concrete proof that a real timeout is what actually restores Phase 3.5's "log and
    // skip, never block course generation" design under real network conditions, not just a
    // theoretical claim about the try/catch already being there.
    const writePromise = writeTopic("crs_1", "Test Topic", ["Prereq A"], client);
    const assertion = expect(writePromise).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(15_000 * 2); // the episode write, then the one prerequisite edge write
    await assertion;

    expect(
      errorSpy.mock.calls.some(([msg]) => typeof msg === "string" && msg.includes("timed out"))
    ).toBe(true);
    errorSpy.mockRestore();
  });
});
