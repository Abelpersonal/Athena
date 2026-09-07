/**
 * A distinguishable error for every one of this codebase's real I/O timeout boundaries (LLM
 * provider calls, Tavily/YouTube-transcript/Memory-Graph MCP calls) — one shared type so a caller
 * or a test can tell "this timed out" apart from "this genuinely errored" via a single
 * `instanceof` check, regardless of which boundary or vendor produced it.
 */
export class TimeoutError extends Error {
  constructor(
    public readonly label: string,
    public readonly timeoutMs: number
  ) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Bounds `fn` to `timeoutMs`, handing it a real `AbortSignal` to wire into whatever native
 * cancellation the underlying call supports (fetch's `signal`, the Anthropic/Gemini SDKs' own
 * `signal`/`abortSignal` request options, the MCP SDK's `RequestOptions.signal`) — the same
 * create-an-AbortController-and-setTimeout shape `extraction/fetchAndClean.ts` already uses for
 * raw HTTP fetches, factored out here since four more real I/O boundaries need the identical
 * pattern (Orchestrator LLM calls, Tavily search, the YouTube transcript MCP adapter, the Memory
 * Graph's MCP calls).
 *
 * `fn`'s own promise is raced against the timer rather than trusted to reject on its own once
 * `signal` aborts — most well-behaved SDKs do reject promptly, but this makes the bound
 * unconditional (a mock, or a genuinely misbehaving dependency, that ignores the signal entirely
 * still can't hang the caller past `timeoutMs`). This is also what makes "a genuine hang times
 * out" provable in a unit test against a promise that never resolves on its own, without needing
 * a real slow network call or trusting a mocked-away SDK's internal timeout enforcement.
 */
export async function withTimeout<T>(
  label: string,
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timedOut = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(label, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([fn(controller.signal), timedOut]);
  } finally {
    clearTimeout(timeoutHandle!);
  }
}
