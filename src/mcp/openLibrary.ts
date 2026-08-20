import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/** One book candidate as confirmed by Open Library's own catalog — real evidence a current edition exists. */
export interface OpenLibraryBookResult {
  title: string;
  author: string;
  workId?: string;
  editionCount?: number;
  firstPublishYear?: number;
}

/**
 * Thin interface calling code depends on, so the underlying MCP server is swappable without
 * touching src/continuousLearning/index.ts — same "one gateway" pattern as SearchProvider
 * (src/mcp/webSearch.ts) and GraphitiMCPClient (src/memoryGraph/graphitiClient.ts).
 */
export interface BookAvailabilityProvider {
  searchBooks(title: string, author?: string): Promise<OpenLibraryBookResult[]>;
}

/**
 * Verified against the real tool source (github.com/cyanheads/openlibrary-mcp-server's
 * openlibrary-search-books.tool.ts) — this is the MCP server's own NORMALIZED output shape
 * (`works[]`, `work_id`, `author_names`), not the raw Open Library search API's shape
 * (`docs[]`, `key`, `author_name`), which is different and easy to guess wrong.
 */
interface OpenLibrarySearchToolResult {
  works?: Array<{
    work_id?: string;
    title?: string;
    author_names?: string[];
    edition_count?: number;
    first_publish_year?: number;
  }>;
}

export interface OpenLibraryMCPProviderOptions {
  maxResults?: number;
  /** Override the command used to launch the MCP server (default: npx). */
  command?: string;
  /** Override the args used to launch the MCP server (default: ["-y", "@cyanheads/openlibrary-mcp-server@latest"]). */
  args?: string[];
}

function processEnvAsStringRecord(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}


/**
 * Adapter over cyanheads/openlibrary-mcp-server (npm: @cyanheads/openlibrary-mcp-server) — run
 * locally via `npx -y @cyanheads/openlibrary-mcp-server@latest` (stdio transport), the same
 * launch pattern as Phase 1's TavilyMCPSearchProvider. No API key needed (Open Library is a free,
 * public catalog). Only the `openlibrary_search_books` tool is used here; its input
 * (`title`/`author`/`limit`) and output (`works[]` with `work_id`/`author_names`/`edition_count`/
 * `first_publish_year` — the MCP server's own NORMALIZED shape, not the raw Open Library search
 * API's `docs[]`/`key`/`author_name` shape, which is different) were read directly from the real
 * tool source (github.com/cyanheads/openlibrary-mcp-server's
 * openlibrary-search-books.tool.ts), not guessed. The class shape stays generic (one client, one
 * tool call per method) so cover-image resolution (`openlibrary_get_cover_url`) could be added
 * later without changing this class's public shape, same as webSearch.ts's own documented intent.
 */
export class OpenLibraryMCPProvider implements BookAvailabilityProvider {
  private client: Client | null = null;
  private connecting: Promise<void> | null = null;
  private readonly maxResults: number;
  private readonly command: string;
  private readonly args: string[];

  constructor(options: OpenLibraryMCPProviderOptions = {}) {
    this.maxResults = options.maxResults ?? 3;
    this.command = options.command ?? "npx";
    this.args = options.args ?? ["-y", "@cyanheads/openlibrary-mcp-server@latest"];
  }

  async searchBooks(title: string, author?: string): Promise<OpenLibraryBookResult[]> {
    const client = await this.ensureConnectedSafe();
    if (!client) return [];

    try {
      const result = await client.callTool({
        name: "openlibrary_search_books",
        arguments: { title, ...(author ? { author } : {}), limit: this.maxResults },
      });
      if (result.isError) {
        console.warn(
          `[openLibrary] Search returned an error for "${title}"${author ? ` by ${author}` : ""}: ${JSON.stringify(result.content)}`
        );
        return [];
      }
      return this.parseResults(result);
    } catch (error) {
      console.warn(`[openLibrary] Search failed for "${title}": ${(error as Error).message}`);
      return [];
    }
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
      console.warn(`[openLibrary] Failed to connect to the Open Library MCP server: ${(error as Error).message}`);
      this.connecting = null;
      return null;
    }
  }

  private async connect(): Promise<void> {
    const transport = new StdioClientTransport({
      command: this.command,
      args: this.args,
      env: processEnvAsStringRecord(),
    });
    const client = new Client({ name: "teacher-continuous-learning", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport);
    this.client = client;
  }

  private parseResults(result: Awaited<ReturnType<Client["callTool"]>>): OpenLibraryBookResult[] {
    const structured = (result as { structuredContent?: OpenLibrarySearchToolResult }).structuredContent;
    let parsed: OpenLibrarySearchToolResult | undefined = structured;

    if (!parsed) {
      const content = result.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === "object" && (block as { type?: unknown }).type === "text") {
            const text = (block as { text?: unknown }).text;
            if (typeof text === "string") {
              try {
                parsed = JSON.parse(text) as OpenLibrarySearchToolResult;
              } catch {
                // fall through — no usable results
              }
            }
          }
        }
      }
    }

    const works = parsed?.works ?? [];
    return works
      .filter((w) => w.title)
      .map((w) => ({
        title: w.title!,
        author: w.author_names?.[0] ?? "Unknown",
        workId: w.work_id,
        editionCount: w.edition_count,
        firstPublishYear: w.first_publish_year,
      }));
  }
}

let defaultProvider: OpenLibraryMCPProvider | null = null;
function getDefaultProvider(): OpenLibraryMCPProvider {
  if (!defaultProvider) {
    defaultProvider = new OpenLibraryMCPProvider();
  }
  return defaultProvider;
}

/** The small adapter calling code uses so it never touches MCP protocol details directly. */
export async function openLibrarySearch(title: string, author?: string): Promise<OpenLibraryBookResult[]> {
  return getDefaultProvider().searchBooks(title, author);
}

/** Closes the default provider's MCP connection (call before process exit). */
export async function closeOpenLibrary(): Promise<void> {
  if (defaultProvider) {
    await defaultProvider.close();
    defaultProvider = null;
  }
}
