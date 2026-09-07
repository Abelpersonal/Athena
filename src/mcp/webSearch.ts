import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { withTimeout } from "../shared/timeout.js";

/** A real web search across multiple sources normally completes well within this — long enough for normal variance, short enough to fail fast on a genuinely hung MCP server/subprocess. */
const SEARCH_TIMEOUT_MS = 20_000;

/**
 * A single search result. source_id is a stable identifier this adapter
 * generates (derived from the URL) so later phases can cite claims back to
 * a specific source without depending on the provider's own IDs.
 */
export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  source_id: string;
  /** The query that produced this result. */
  query: string;
  /** Publish date as reported by the search provider, if any (used for volatility tagging in Phase 2). */
  publishedDate?: string;
}

/**
 * Thin interface every search provider implements, so the underlying MCP
 * server (or non-MCP provider) is swappable without touching calling code.
 * Phase 2's Research Agent may want to run more than one of these at once
 * (e.g. Tavily + Exa) for contention-pass research.
 */
export interface SearchProvider {
  search(queries: string[]): Promise<SearchResult[]>;
}

interface TavilyResultItem {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string;
}

export interface TavilyMCPSearchProviderOptions {
  apiKey?: string;
  maxResultsPerQuery?: number;
  /** Override the command used to launch the MCP server (default: npx). */
  command?: string;
  /** Override the args used to launch the MCP server (default: ["-y", "tavily-mcp"]). */
  args?: string[];
}

function processEnvAsStringRecord(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function makeSourceId(url: string): string {
  return `src_${createHash("sha1").update(url).digest("hex").slice(0, 12)}`;
}

function extractResultItems(parsed: unknown): TavilyResultItem[] {
  if (Array.isArray(parsed)) return parsed as TavilyResultItem[];
  if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { results?: unknown }).results)
  ) {
    return (parsed as { results: TavilyResultItem[] }).results;
  }
  return [];
}

/**
 * The real tavily_search tool (confirmed live, both keyless and with an API
 * key) returns a plain-text block, not JSON — a "Detailed Results:" header
 * followed by repeated `Title: / ID: / URL: / Content:` groups separated by
 * blank lines. Parses that shape directly rather than assuming JSON.
 */
function parseDetailedResultsText(text: string): TavilyResultItem[] {
  const body = text.replace(/^Detailed Results:\s*/i, "");
  const entries = body.split(/\n(?=Title:\s)/).map((e) => e.trim()).filter(Boolean);

  const items: TavilyResultItem[] = [];
  for (const entry of entries) {
    const url = entry.match(/URL:\s*(.*)/)?.[1]?.trim();
    if (!url) continue;
    items.push({
      url,
      title: entry.match(/Title:\s*(.*)/)?.[1]?.trim(),
      content: entry.match(/Content:\s*([\s\S]*)/)?.[1]?.trim(),
    });
  }
  return items;
}

/**
 * Adapter over Tavily's official MCP server (tavily-ai/tavily-mcp, npm
 * package `tavily-mcp`). Run locally via `npx -y tavily-mcp` (stdio
 * transport) rather than wiring up Tavily's hosted MCP endpoint — no extra
 * infra to stand up for a single-user project, and it's what the published
 * package is designed for. See README for the swap-provider instructions.
 *
 * Only the search tool is used in Phase 1. The class shape (one client
 * wrapping multiple tool calls) is deliberately generic so extract/map/crawl
 * can be added as additional methods later (Phase 3's Material Aggregator)
 * without changing this class's public shape.
 */
export class TavilyMCPSearchProvider implements SearchProvider {
  private client: Client | null = null;
  private connecting: Promise<void> | null = null;
  private readonly apiKey: string;
  private readonly maxResultsPerQuery: number;
  private readonly command: string;
  private readonly args: string[];

  constructor(options: TavilyMCPSearchProviderOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.TAVILY_API_KEY ?? "";
    this.maxResultsPerQuery = options.maxResultsPerQuery ?? 5;
    this.command = options.command ?? "npx";
    this.args = options.args ?? ["-y", "tavily-mcp"];
    if (!this.apiKey) {
      console.warn(
        "[webSearch] TAVILY_API_KEY is not set — the Tavily MCP server will likely reject every search."
      );
    }
  }

  async search(queries: string[]): Promise<SearchResult[]> {
    if (queries.length === 0) return [];

    const client = await this.ensureConnectedSafe();
    if (!client) return [];

    const perQueryResults = await Promise.all(
      queries.map((query) => this.searchOne(client, query))
    );
    return perQueryResults.flat();
  }

  /** Closes the MCP client/transport (terminates the spawned server process). */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    this.connecting = null;
  }

  private async ensureConnectedSafe(): Promise<Client | null> {
    try {
      if (this.client) return this.client;
      if (!this.connecting) {
        this.connecting = this.connect();
      }
      await this.connecting;
      return this.client;
    } catch (error) {
      console.warn(
        `[webSearch] Failed to connect to the Tavily MCP server: ${(error as Error).message}`
      );
      this.connecting = null;
      return null;
    }
  }

  private async connect(): Promise<void> {
    const transport = new StdioClientTransport({
      command: this.command,
      args: this.args,
      env: { ...processEnvAsStringRecord(), TAVILY_API_KEY: this.apiKey },
    });
    const client = new Client({ name: "teacher-orchestrator", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport);
    this.client = client;
  }

  private async searchOne(client: Client, query: string): Promise<SearchResult[]> {
    try {
      // `timeout` is the MCP SDK's own RequestOptions field (its documented, native mechanism —
      // raises an McpError(RequestTimeout) from request() on real infrastructure); `signal` is
      // this call's own AbortController, sourced from withTimeout, on the SAME RequestOptions
      // object — not a second, competing mechanism. `signal` is what makes a genuine hang
      // provably bounded under a fully-mocked Client in tests (this codebase's established MCP
      // test convention), where the real request()'s own timeout enforcement can't be exercised.
      const result = await withTimeout(`Tavily search "${query}"`, SEARCH_TIMEOUT_MS, (signal) =>
        client.callTool(
          { name: "tavily_search", arguments: { query, max_results: this.maxResultsPerQuery } },
          undefined,
          { timeout: SEARCH_TIMEOUT_MS, signal }
        )
      );

      if (result.isError) {
        console.warn(
          `[webSearch] Tavily search returned an error for query "${query}": ${JSON.stringify(result.content)}`
        );
        return [];
      }

      return this.parseResults(result.content, query);
    } catch (error) {
      console.warn(
        `[webSearch] Search failed for query "${query}": ${(error as Error).message}`
      );
      return [];
    }
  }

  private parseResults(content: unknown, query: string): SearchResult[] {
    if (!Array.isArray(content)) return [];

    const results: SearchResult[] = [];
    for (const block of content) {
      if (!block || typeof block !== "object" || (block as { type?: unknown }).type !== "text") {
        continue;
      }
      const text = (block as { text?: unknown }).text;
      if (typeof text !== "string") continue;

      // Try JSON first (some configurations/versions may return it); the
      // confirmed-live shape is plain "Title: / URL: / Content:" text, so
      // fall back to parsing that rather than silently dropping real results.
      let items: TavilyResultItem[];
      try {
        items = extractResultItems(JSON.parse(text));
      } catch {
        items = [];
      }
      if (items.length === 0) {
        items = parseDetailedResultsText(text);
      }

      for (const item of items) {
        if (!item.url) continue;
        results.push({
          url: item.url,
          title: item.title ?? item.url,
          snippet: item.content ?? "",
          source_id: makeSourceId(item.url),
          query,
          ...(item.published_date ? { publishedDate: item.published_date } : {}),
        });
      }
    }
    return results;
  }
}

let defaultProvider: TavilyMCPSearchProvider | null = null;
function getDefaultProvider(): TavilyMCPSearchProvider {
  if (!defaultProvider) {
    defaultProvider = new TavilyMCPSearchProvider();
  }
  return defaultProvider;
}

/**
 * The small adapter calling code uses so it never touches MCP protocol
 * details directly. A failed or empty search returns an empty/partial
 * result set with a logged warning — it never throws.
 */
export async function webSearch(queries: string[]): Promise<SearchResult[]> {
  return getDefaultProvider().search(queries);
}

/** Closes the default provider's MCP connection (call before process exit). */
export async function closeWebSearch(): Promise<void> {
  if (defaultProvider) {
    await defaultProvider.close();
    defaultProvider = null;
  }
}
