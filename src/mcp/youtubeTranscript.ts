import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { withTimeout } from "../shared/timeout.js";

/** Longer than the search timeout — fetching and formatting captions for a potentially long real video takes a bit more time than a search query, but should still fail fast on a genuinely hung MCP server/subprocess. */
const TRANSCRIPT_TIMEOUT_MS = 30_000;

/** One caption line, with its real, natural-format timestamp (e.g. "4:32", "1:04:32" once past an hour) — never flattened into plain prose, since the timestamp is exactly what the locator (src/shared/locator.ts) needs to anchor a citation. */
export interface TranscriptSegment {
  timestamp: string;
  text: string;
}

export interface TranscriptResult {
  title: string;
  segments: TranscriptSegment[];
  /** The video's real total duration in whole seconds (from the MCP server's own `_meta.totalDuration`) — the known bound the locator sanity check (src/research/grounding.ts) compares a cited timestamp against. */
  totalDurationSeconds: number;
}

/** Thin interface, mirroring `SearchProvider` (src/mcp/webSearch.ts) — the underlying MCP server is swappable without touching calling code. */
export interface TranscriptProvider {
  getTranscript(videoUrl: string): Promise<TranscriptResult | null>;
}

export interface YoutubeTranscriptMCPProviderOptions {
  /** Override the command used to launch the MCP server (default: npx). */
  command?: string;
  /** Override the args used to launch the MCP server (default: ["-y", "@sinco-lab/mcp-youtube-transcript"]). */
  args?: string[];
}

/**
 * The real server's `get_timed_transcript` tool (confirmed live by extracting and reading its
 * published package, `@sinco-lab/mcp-youtube-transcript@0.0.12`) returns one text block:
 * `"# {title}\n\n{lines}"`, each line `[HH:MM:SS.mmm] caption text` (its own
 * `YouTubeUtils.formatTimedTranscriptText` — one line per real caption segment, never
 * paragraph-flattened), plus a `_meta` object carrying `title`/`totalDuration` (seconds) directly
 * — no separate metadata call needed. Parses that real, confirmed shape rather than guessing at
 * a JSON schema the server doesn't actually return.
 */
const TIMED_LINE_PATTERN = /^\[(\d{2}):(\d{2}):(\d{2})\.\d{3}\]\s?(.*)$/;

/**
 * Real captions from `get_timed_transcript` are one line per few SECONDS of video — a genuine
 * hour-long video is many hundreds of raw lines. Returning one `TranscriptSegment` per raw line
 * would later fan out into one `SourceExcerpt` per line in `extractGroundedKeyPoints`'s prompt
 * (`extraction/fetchAndClean.ts`'s `fetchAndCleanVideo` maps segments 1:1 to chunks) — hundreds of
 * excerpts, each mostly per-excerpt header overhead around a few words of real caption. Grouping
 * raw lines into fixed windows of this many seconds each (a chunk's `text` is every caption in
 * that window, joined; its `timestamp` is the window's first real caption's own timestamp) keeps a
 * video's chunk count in the same ballpark as a PDF's page count for a typically-sized source.
 */
const CAPTION_WINDOW_SECONDS = 180;

function toNaturalTimestamp(hh: string, mm: string, ss: string): string {
  const hours = Number(hh);
  const minutes = Number(mm);
  const seconds = ss.padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`;
  return `${minutes}:${seconds}`;
}

interface RawCaptionLine {
  seconds: number;
  timestamp: string;
  text: string;
}

function groupIntoWindows(lines: RawCaptionLine[]): TranscriptSegment[] {
  const windows: TranscriptSegment[] = [];
  let windowStart: RawCaptionLine | undefined;
  let windowTexts: string[] = [];

  for (const line of lines) {
    if (windowStart && line.seconds - windowStart.seconds >= CAPTION_WINDOW_SECONDS) {
      windows.push({ timestamp: windowStart.timestamp, text: windowTexts.join(" ") });
      windowStart = undefined;
      windowTexts = [];
    }
    windowStart ??= line;
    windowTexts.push(line.text);
  }
  if (windowStart) {
    windows.push({ timestamp: windowStart.timestamp, text: windowTexts.join(" ") });
  }
  return windows;
}

function parseTimedTranscriptText(text: string): { title: string; segments: TranscriptSegment[]; maxSeconds: number } {
  const lines = text.split("\n");
  const title = lines[0]?.replace(/^#\s*/, "").trim() ?? "";
  const rawLines: RawCaptionLine[] = [];
  let maxSeconds = 0;
  for (const line of lines) {
    const match = TIMED_LINE_PATTERN.exec(line);
    if (!match) continue;
    const [, hh, mm, ss, caption] = match;
    if (!caption) continue;
    const seconds = Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
    rawLines.push({ seconds, timestamp: toNaturalTimestamp(hh!, mm!, ss!), text: caption });
    maxSeconds = Math.max(maxSeconds, seconds);
  }
  return { title, segments: groupIntoWindows(rawLines), maxSeconds };
}

/**
 * Adapter over `@sinco-lab/mcp-youtube-transcript` (npm-published, actively maintained,
 * TypeScript, no API key — it reads YouTube's own caption data). Launched the exact same way
 * Tavily's MCP server already is (`src/mcp/webSearch.ts`): `npx -y <package>` over stdio, not
 * added as a `package.json` dependency — `npx` fetches/caches it on demand, matching the existing
 * convention (`tavily-mcp` isn't a dependency either).
 */
export class YoutubeTranscriptMCPProvider implements TranscriptProvider {
  private client: Client | null = null;
  private connecting: Promise<void> | null = null;
  private readonly command: string;
  private readonly args: string[];

  constructor(options: YoutubeTranscriptMCPProviderOptions = {}) {
    this.command = options.command ?? "npx";
    this.args = options.args ?? ["-y", "@sinco-lab/mcp-youtube-transcript"];
  }

  async getTranscript(videoUrl: string): Promise<TranscriptResult | null> {
    const client = await this.ensureConnectedSafe();
    if (!client) return null;

    try {
      // Same rationale as webSearch.ts's searchOne(): `timeout` is the MCP SDK's own native
      // RequestOptions field, `signal` is this call's own AbortController (from withTimeout) on
      // the same options object — the latter is what makes a genuine hang provably bounded under
      // a fully-mocked Client in tests, where the real request()'s own enforcement is bypassed.
      const result = await withTimeout(`YouTube transcript for ${videoUrl}`, TRANSCRIPT_TIMEOUT_MS, (signal) =>
        client.callTool(
          { name: "get_timed_transcript", arguments: { url: videoUrl } },
          undefined,
          { timeout: TRANSCRIPT_TIMEOUT_MS, signal }
        )
      );
      if (result.isError) {
        console.warn(`[youtubeTranscript] get_timed_transcript returned an error for ${videoUrl}: ${JSON.stringify(result.content)}`);
        return null;
      }
      return this.parseResult(result.content);
    } catch (error) {
      console.warn(`[youtubeTranscript] Failed to fetch a transcript for ${videoUrl}: ${(error as Error).message}`);
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
      console.warn(`[youtubeTranscript] Failed to connect to the YouTube transcript MCP server: ${(error as Error).message}`);
      this.connecting = null;
      return null;
    }
  }

  private async connect(): Promise<void> {
    const transport = new StdioClientTransport({ command: this.command, args: this.args });
    const client = new Client({ name: "teacher-orchestrator", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport);
    this.client = client;
  }

  private parseResult(content: unknown): TranscriptResult | null {
    if (!Array.isArray(content)) return null;
    for (const block of content) {
      if (!block || typeof block !== "object" || (block as { type?: unknown }).type !== "text") continue;
      const text = (block as { text?: unknown }).text;
      if (typeof text !== "string") continue;

      const meta = (block as { _meta?: { title?: string; totalDuration?: number } })._meta;
      const { title: parsedTitle, segments, maxSeconds } = parseTimedTranscriptText(text);
      if (segments.length === 0) return null;

      // Prefer the server's own reported total duration; fall back to the last real caption's
      // own timestamp when it's missing — still a real, observed bound, never a guess.
      const totalDurationSeconds = Math.ceil(meta?.totalDuration ?? maxSeconds);

      return { title: meta?.title ?? parsedTitle, segments, totalDurationSeconds };
    }
    return null;
  }
}

let defaultProvider: YoutubeTranscriptMCPProvider | null = null;
function getDefaultProvider(): YoutubeTranscriptMCPProvider {
  if (!defaultProvider) {
    defaultProvider = new YoutubeTranscriptMCPProvider();
  }
  return defaultProvider;
}

/** The small adapter calling code uses so it never touches MCP protocol details directly. A failed or captionless video returns null with a logged warning — it never throws (matches webSearch()'s "never throw" convention). */
export async function getTranscript(videoUrl: string): Promise<TranscriptResult | null> {
  return getDefaultProvider().getTranscript(videoUrl);
}

/** Closes the default provider's MCP connection (call before process exit). */
export async function closeYoutubeTranscript(): Promise<void> {
  if (defaultProvider) {
    await defaultProvider.close();
    defaultProvider = null;
  }
}
