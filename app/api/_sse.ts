/**
 * Shared SSE framing for the three genuinely multi-minute generation routes (course build, path
 * decompose, topic generate) — see the README's "Progress feedback (SSE)" section for why GET/
 * EventSource was chosen over polling. Not a route itself (the leading underscore keeps Next's
 * router from treating this directory as a route segment).
 *
 * Event names deliberately avoid "error" for the failure event (named "failed" instead) — a
 * browser EventSource dispatches its OWN native "error" event (a plain Event, no .data) on a real
 * connection failure, and reusing that name for a server-sent custom event would make the two
 * genuinely ambiguous to a client listener. "failed" carries a real JSON payload; "error" stays
 * exclusively the browser's own connection-level signal.
 */
export function createSseResponse<T>(run: (send: (message: string) => void) => Promise<T>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        const result = await run((message) => emit("progress", { message }));
        emit("done", result);
      } catch (error) {
        emit("failed", { message: error instanceof Error ? error.message : String(error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
