import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { withTimeout } from "../shared/timeout.js";
import { isErrorResponse } from "./types.js";

/**
 * Deliberately the SHORTEST of the three MCP timeouts — Phase 3.5's whole design premise is
 * "log and skip on failure, never block course generation" (every call site in
 * `memoryGraph/index.ts` wraps this in try/catch); without a timeout, a hang defeats that design
 * entirely (the call never fails, it just never returns). A short bound is what makes the
 * intended degrade-gracefully behavior actually feel graceful under real network conditions,
 * rather than adding a long stall to every subtopic/course write.
 */
const GRAPH_TIMEOUT_MS = 15_000;

/**
 * Graphiti's MCP server (getzep/graphiti's mcp_server, run via
 * mcp_server/docker-compose.yml — see README) exposes a single HTTP endpoint
 * and speaks the modern MCP Streamable HTTP transport
 * (server.transport: "http" in its config.yaml maps to run_streamable_http_async();
 * "sse" is explicitly marked deprecated upstream) — confirmed by reading
 * getzep/graphiti's actual mcp_server source, not assumed from Phase 1's
 * stdio-based Tavily pattern. This is a genuinely different transport from
 * `src/mcp/webSearch.ts`'s StdioClientTransport, so it gets its own client
 * class rather than reusing that one.
 */
export interface GraphitiMCPClientOptions {
  /** Default: http://localhost:8000/mcp/ (or GRAPHITI_MCP_URL env var). */
  url?: string;
}

const DEFAULT_URL = "http://localhost:8000/mcp/";

export class GraphitiMCPClient {
  private client: Client | null = null;
  private connecting: Promise<void> | null = null;
  private readonly url: string;

  constructor(options: GraphitiMCPClientOptions = {}) {
    this.url = options.url ?? process.env.GRAPHITI_MCP_URL ?? DEFAULT_URL;
  }

  /** Closes the MCP client connection. */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    this.connecting = null;
  }

  /**
   * Lazily connects and returns the client, or null (with a logged warning)
   * if the Memory Graph server is unreachable — never throws, so every
   * caller can degrade to "skip the write/read" rather than crashing.
   */
  async ensureConnectedSafe(): Promise<Client | null> {
    try {
      if (this.client) return this.client;
      if (!this.connecting) {
        this.connecting = this.connect();
      }
      await this.connecting;
      return this.client;
    } catch (error) {
      console.error(
        `[memory-graph] Could not connect to the Graphiti MCP server at ${this.url}: ${(error as Error).message}. ` +
          "Is `docker compose up` running in mcp_server/? See README."
      );
      this.connecting = null;
      return null;
    }
  }

  private async connect(): Promise<void> {
    const transport = new StreamableHTTPClientTransport(new URL(this.url));
    const client = new Client({ name: "teacher-memory-graph", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport);
    this.client = client;
  }

  /**
   * Calls one Graphiti tool and returns its parsed result. Graphiti's
   * @mcp.tool()-decorated functions return typed dicts, which the Python MCP
   * SDK may surface as `structuredContent` (already-parsed) or only as a
   * JSON-stringified text content block, depending on server/SDK version —
   * this hasn't been live-verified against a running server in this
   * environment (see README), so both shapes are handled defensively rather
   * than assuming one. Throws on a genuine transport-level error or an
   * ErrorResponse `{error}` payload, so callers can log/degrade per call.
   */
  async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const client = await this.ensureConnectedSafe();
    if (!client) {
      throw new Error(`Not connected to the Graphiti MCP server (tool: "${name}").`);
    }

    // Same rationale as webSearch.ts's searchOne()/youtubeTranscript.ts's getTranscript(): `timeout`
    // is the MCP SDK's own native RequestOptions field, `signal` is this call's own
    // AbortController (from withTimeout) on the same options object — the latter is what makes a
    // genuine hang provably bounded under a fully-mocked Client in tests, and is what actually
    // restores this module's "log and skip, never block" design under real network conditions.
    const result = await withTimeout(`Graphiti ${name}`, GRAPH_TIMEOUT_MS, (signal) =>
      client.callTool({ name, arguments: args }, undefined, { timeout: GRAPH_TIMEOUT_MS, signal })
    );
    if (result.isError) {
      throw new Error(`Graphiti tool "${name}" returned an error: ${JSON.stringify(result.content)}`);
    }

    const parsed = this.extractResult(result, name);
    if (isErrorResponse(parsed)) {
      throw new Error(`Graphiti tool "${name}" returned an error: ${parsed.error}`);
    }
    return parsed as T;
  }

  private extractResult(result: Awaited<ReturnType<Client["callTool"]>>, toolName: string): unknown {
    const structured = (result as { structuredContent?: unknown }).structuredContent;
    if (structured && typeof structured === "object") {
      return structured;
    }

    const content = result.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block === "object" && (block as { type?: unknown }).type === "text") {
          const text = (block as { text?: unknown }).text;
          if (typeof text === "string") {
            try {
              return JSON.parse(text);
            } catch {
              // fall through to the error below
            }
          }
        }
      }
    }
    throw new Error(`Graphiti tool "${toolName}" returned an unrecognized result shape.`);
  }
}
