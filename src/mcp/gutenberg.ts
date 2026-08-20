import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/** A confirmed legitimate free/open full-text match on Project Gutenberg. */
export interface GutenbergMatch {
  gutenbergId: number;
  title: string;
  /** The book's public Gutenberg page (links to every available format) — not a direct file download, per the PRD's "link/summarize, don't download copyrighted works" guidance (moot here since Gutenberg texts are public domain, but the same stable-link habit applies). */
  url: string;
}

/**
 * Thin interface calling code depends on — same "one gateway" pattern as BookAvailabilityProvider
 * (src/mcp/openLibrary.ts). Returns null (never throws) when no legitimate free full text is
 * found, so callers can treat "not on Gutenberg" as a normal, common outcome, not an error.
 */
export interface FreeTextAvailabilityProvider {
  checkAvailability(title: string, author?: string): Promise<GutenbergMatch | null>;
}

interface GutenbergSearchToolResult {
  books?: Array<{
    id: number;
    title: string;
    authors?: Array<{ name: string }>;
    has_plain_text?: boolean;
  }>;
}

export interface GutenbergMCPProviderOptions {
  /** Override the command used to launch the MCP server (default: npx). */
  command?: string;
  /** Override the args used to launch the MCP server (default: ["-y", "@cyanheads/gutenberg-mcp-server@latest"]). */
  args?: string[];
}

function processEnvAsStringRecord(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function titlesLooselyMatch(a: string, b: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const na = normalize(a);
  const nb = normalize(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * Adapter over cyanheads/gutenberg-mcp-server (npm: @cyanheads/gutenberg-mcp-server) — run locally
 * via `npx -y @cyanheads/gutenberg-mcp-server@latest` (stdio transport), same launch pattern as
 * Phase 1's TavilyMCPSearchProvider. No API key needed (Project Gutenberg's catalog is free,
 * public domain data), confirmed from the package's own source (its `gutenberg_search_books` tool
 * definition — `query`/`topic`/`languages`/`sort`/`ids`/`page` input, `books[].has_plain_text`
 * output — was read directly from
 * github.com/cyanheads/gutenberg-mcp-server/src/mcp-server/tools/definitions, not guessed).
 * Used here purely for AVAILABILITY confirmation (Deliverable 1's "verify... legitimate free/open
 * availability"), per the PRD's copyright constraint — this never fetches full text
 * (`gutenberg_get_text` is intentionally not called anywhere in this codebase).
 */
export class GutenbergMCPProvider implements FreeTextAvailabilityProvider {
  private client: Client | null = null;
  private connecting: Promise<void> | null = null;
  private readonly command: string;
  private readonly args: string[];

  constructor(options: GutenbergMCPProviderOptions = {}) {
    this.command = options.command ?? "npx";
    this.args = options.args ?? ["-y", "@cyanheads/gutenberg-mcp-server@latest"];
  }

  async checkAvailability(title: string, author?: string): Promise<GutenbergMatch | null> {
    const client = await this.ensureConnectedSafe();
    if (!client) return null;

    try {
      const query = author ? `${title} ${author}` : title;
      const result = await client.callTool({
        name: "gutenberg_search_books",
        arguments: { query, sort: "popular", page: 1 },
      });
      if (result.isError) {
        // "no_results" is a normal, expected outcome (most books aren't on Gutenberg) — not logged as a warning.
        return null;
      }
      return this.parseFirstMatch(result, title);
    } catch (error) {
      console.warn(`[gutenberg] Availability check failed for "${title}": ${(error as Error).message}`);
      return null;
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
      console.warn(`[gutenberg] Failed to connect to the Gutenberg MCP server: ${(error as Error).message}`);
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

  private parseFirstMatch(
    result: Awaited<ReturnType<Client["callTool"]>>,
    expectedTitle: string
  ): GutenbergMatch | null {
    const structured = (result as { structuredContent?: GutenbergSearchToolResult }).structuredContent;
    let parsed: GutenbergSearchToolResult | undefined = structured;

    if (!parsed) {
      const content = result.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === "object" && (block as { type?: unknown }).type === "text") {
            const text = (block as { text?: unknown }).text;
            if (typeof text === "string") {
              try {
                parsed = JSON.parse(text) as GutenbergSearchToolResult;
              } catch {
                // fall through — no usable results
              }
            }
          }
        }
      }
    }

    const match = (parsed?.books ?? []).find(
      (b) => b.has_plain_text && titlesLooselyMatch(b.title, expectedTitle)
    );
    if (!match) return null;
    return { gutenbergId: match.id, title: match.title, url: `https://www.gutenberg.org/ebooks/${match.id}` };
  }
}

let defaultProvider: GutenbergMCPProvider | null = null;
function getDefaultProvider(): GutenbergMCPProvider {
  if (!defaultProvider) {
    defaultProvider = new GutenbergMCPProvider();
  }
  return defaultProvider;
}

/** The small adapter calling code uses so it never touches MCP protocol details directly. */
export async function gutenbergCheck(title: string, author?: string): Promise<GutenbergMatch | null> {
  return getDefaultProvider().checkAvailability(title, author);
}

/** Closes the default provider's MCP connection (call before process exit). */
export async function closeGutenberg(): Promise<void> {
  if (defaultProvider) {
    await defaultProvider.close();
    defaultProvider = null;
  }
}
