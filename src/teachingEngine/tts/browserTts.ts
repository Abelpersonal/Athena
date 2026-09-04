import type { TTSProvider, TTSResult } from "./types.js";

/**
 * The Stage 1 prototype (window.speechSynthesis) is inherently a BROWSER API — it cannot run
 * server-side, so there is no real implementation of synthesize() here. This class exists purely
 * as a defense-in-depth sentinel: TTS_PROVIDER=browser is meant to route the Lesson page's
 * AudioPlayer into client-side speechSynthesis and never call `/api/lessons/:id/audio` at all
 * (see app/lessons/[id]/page.tsx, which reads TTS_PROVIDER server-side and passes a plain
 * `mode: "browser" | "server"` prop down rather than letting the client hit this path). If a
 * server-side call somehow reaches this provider anyway (a bug, not an expected path), it fails
 * loudly and explains why, rather than silently returning nothing playable.
 */
export class BrowserTtsProvider implements TTSProvider {
  readonly name = "browser";

  async synthesize(_text: string): Promise<TTSResult> {
    throw new Error(
      "BrowserTtsProvider.synthesize() was called server-side — window.speechSynthesis only runs in the browser. " +
        "This indicates a routing bug: TTS_PROVIDER=browser should keep AudioPlayer entirely client-side " +
        "and never call /api/lessons/:id/audio."
    );
  }
}
