"use client";

import { useEffect, useRef, useState } from "react";
import type { LessonAudioChunk, LessonAudioTrack } from "../src/teachingEngine/chunkLessonAudio.js";
import { getOfflineAudioObjectUrl } from "../lib/offline/db.js";

export type AudioPlayerMode = "browser" | "server";
type Speed = 1 | 1.5 | 2;

function chunkAudioUrl(lessonId: string, chunk: LessonAudioChunk): string {
  return `/api/lessons/${lessonId}/audio?layer=${chunk.layer}&chunkIndex=${chunk.chunkIndex}`;
}

function chunkLabel(chunk: LessonAudioChunk): string {
  return `${chunk.layer[0]!.toUpperCase()}${chunk.layer.slice(1)}, part ${chunk.chunkIndex + 1}`;
}

/**
 * The Lesson screen's audio player, replacing Phase 7's `PlaceholderPanel`. Two modes behind one
 * component (see README, "TTS_PROVIDER, no silent fallback" — the Lesson page reads TTS_PROVIDER
 * server-side and passes this down as a plain prop):
 *
 * - "browser" (Stage 1 prototype, zero API cost): drives `window.speechSynthesis` directly, chunk
 *   by chunk, never calling `/api/lessons/:id/audio` at all.
 * - "server" (Stage 2, OpenAI TTS behind the cache): a real `<audio>` element pointed at that
 *   route, one chunk at a time; the NEXT chunk's audio is prefetched (a background `Audio()`
 *   load, relying on the route's `immutable` cache header) while the current one plays, satisfying
 *   "begin playback of chunk 1 while chunk 2+ are still generating" without hand-rolled streaming.
 *
 * Only chunks belonging to the "intuition" layer, plus (once `deeperLayersExpanded` is true) every
 * other layer, are ever requested — a collapsed formal/frontier layer's audio is never generated.
 *
 * Skip-back-10s: real `<audio>.currentTime -= 10` in "server" mode; the Web Speech API has no real
 * seek, so "browser" mode approximates it by restarting the current chunk from its beginning —
 * documented here as a Stage-1-only limitation, not a Stage-2 gap.
 *
 * Media Session wiring covers a BACKGROUNDED BROWSER TAB (lock-screen/notification transport
 * controls), not "app fully closed" — that stronger guarantee needs Phase 10's PWA work or a
 * native wrapper (out of scope here, same as the kickoff prompt's own scope boundary).
 */
export function AudioPlayer({
  lessonId,
  track,
  mode,
  deeperLayersExpanded,
}: {
  lessonId: string;
  track: LessonAudioTrack;
  mode: AudioPlayerMode;
  deeperLayersExpanded: boolean;
}) {
  const availableChunks = track.chunks.filter((c) => c.layer === "intuition" || deeperLayersExpanded);

  const [chunkPos, setChunkPos] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prefetchedRef = useRef<Set<string>>(new Set());
  const objectUrlRef = useRef<string | null>(null);

  // If the deeper layers collapse again while one of their chunks is playing, fall back to the
  // last intuition chunk rather than pointing at a chunk that's no longer "available".
  useEffect(() => {
    // Reviewed (Phase 11 lint pass): clamping an index against a bound that just changed
    // (deeper layers collapsing shrinks `availableChunks`) is the standard React-documented
    // pattern for "adjusting state when a prop changes" — there's no prop/derived-value this
    // could be computed from at render time instead, since `chunkPos` is the source of truth
    // for which chunk is playing, not a value derived from `availableChunks` itself.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (chunkPos >= availableChunks.length) setChunkPos(Math.max(0, availableChunks.length - 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableChunks.length]);

  const currentChunk = availableChunks[chunkPos];

  /**
   * Phase 10, Deliverable 3: prefers a downloaded chunk's real IndexedDB Blob over the network
   * URL, so a course downloaded for offline plays back genuinely offline — not just incidentally,
   * via the service worker's own opportunistic response caching (which also happens, but isn't
   * guaranteed to survive storage pressure the way an explicit IndexedDB download is meant to).
   * Sets the network URL first (the safe, correct default online), then upgrades to the offline
   * Blob URL if one exists — a harmless brief failed request if genuinely offline with no download.
   */
  useEffect(() => {
    // Reviewed (Phase 11 lint pass): this effect's whole job is resolving `currentChunk`/`mode`
    // into the real audio src (network URL first, then an async IndexedDB lookup) — every
    // setState call here IS the synchronization work the effect exists to do, the textbook case
    // an effect is actually for, not a substitute for a render-time computation.
    if (mode !== "server" || !currentChunk) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResolvedSrc(null);
      return;
    }
    const networkUrl = chunkAudioUrl(lessonId, currentChunk);
    setResolvedSrc(networkUrl);
    let cancelled = false;
    void getOfflineAudioObjectUrl(networkUrl)
      .then((offlineUrl) => {
        if (cancelled || !offlineUrl) return;
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = offlineUrl;
        setResolvedSrc(offlineUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentChunk, mode, lessonId]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  function play() {
    if (!currentChunk) return;
    setIsPlaying(true);
    if (mode === "browser") {
      const utterance = new SpeechSynthesisUtterance(currentChunk.text);
      utterance.rate = speed;
      utterance.onend = () => advance();
      window.speechSynthesis.speak(utterance);
    } else {
      audioRef.current?.play().catch(() => setIsPlaying(false));
    }
  }

  function pause() {
    setIsPlaying(false);
    if (mode === "browser") {
      window.speechSynthesis.pause();
    } else {
      audioRef.current?.pause();
    }
  }

  function advance() {
    if (chunkPos < availableChunks.length - 1) {
      setChunkPos((p) => p + 1);
    } else {
      setIsPlaying(false);
    }
  }

  function skipBack10() {
    if (mode === "server" && audioRef.current) {
      audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 10);
      return;
    }
    // Stage 1 (browser): no real seek — restart the current chunk from its beginning.
    if (mode === "browser" && currentChunk) {
      window.speechSynthesis.cancel();
      play();
    }
  }

  // Auto-play the newly-selected chunk (advance() lands here via chunkPos changing).
  useEffect(() => {
    // Reviewed (Phase 11 lint pass): `play()` starts real media playback (an external system —
    // the Web Speech API or an <audio> element), which is exactly what an effect is for; the
    // setIsPlaying(true) inside it is a side effect of that real action, not a derived-state
    // substitute for one.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isPlaying) play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunkPos]);

  // Server mode: prefetch the NEXT chunk's audio while the current one plays.
  useEffect(() => {
    if (mode !== "server") return;
    const next = availableChunks[chunkPos + 1];
    if (!next) return;
    const url = chunkAudioUrl(lessonId, next);
    if (prefetchedRef.current.has(url)) return;
    prefetchedRef.current.add(url);
    const prefetch = new Audio();
    prefetch.preload = "auto";
    prefetch.src = url;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunkPos, mode]);

  // Media Session — real transport controls while a mobile browser tab is backgrounded/locked.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator) || !currentChunk) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: chunkLabel(currentChunk),
      artist: "Athena",
    });
    navigator.mediaSession.setActionHandler("play", play);
    navigator.mediaSession.setActionHandler("pause", pause);
    navigator.mediaSession.setActionHandler("seekbackward", skipBack10);
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("seekbackward", null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChunk, isPlaying]);

  useEffect(() => {
    if (mode === "server" && audioRef.current) audioRef.current.playbackRate = speed;
    if (mode === "browser" && isPlaying) {
      // Web Speech has no live rate change mid-utterance — restart at the new rate. Reviewed
      // (Phase 11 lint pass): same real-media-control case as the chunkPos effect above.
      window.speechSynthesis.cancel();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      play();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speed]);

  if (!currentChunk) return null;

  return (
    <div className="rounded-lg border border-[var(--color-border)] p-4 space-y-3">
      {mode === "server" && resolvedSrc && (
        <audio
          ref={audioRef}
          src={resolvedSrc}
          onEnded={advance}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
      )}
      {/* min-h/min-w-11 (44px) on every control: a real touch-target size pass (Phase 10, Deliverable 1), not just desktop-sized buttons that happen to also be clickable on a phone. */}
      <div className="flex items-center gap-3 text-sm flex-wrap">
        <button
          onClick={() => (isPlaying ? pause() : play())}
          aria-pressed={isPlaying}
          aria-label={isPlaying ? "Pause" : "Play"}
          className="min-h-11 min-w-11 rounded-md border border-[var(--color-border)] px-3 py-1.5 hover:border-[var(--color-accent)]"
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button
          onClick={skipBack10}
          aria-label="Skip back 10 seconds"
          className="min-h-11 min-w-11 rounded-md border border-[var(--color-border)] px-3 py-1.5 hover:border-[var(--color-accent)]"
        >
          -10s
        </button>
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Playback speed</span>
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value) as Speed)}
            aria-label="Playback speed"
            className="min-h-11 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5"
          >
            <option value={1}>1x</option>
            <option value={1.5}>1.5x</option>
            <option value={2}>2x</option>
          </select>
        </label>
        {/* aria-live: a screen reader announces the chunk/playing-state change without needing focus moved to it — Phase 11's accessibility pass. */}
        <span className="text-[var(--color-text-faint)]" aria-live="polite">
          {isPlaying ? "Playing: " : "Paused: "}
          {chunkLabel(currentChunk)} ({chunkPos + 1}/{availableChunks.length})
        </span>
      </div>
    </div>
  );
}
