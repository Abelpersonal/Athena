"use client";

import { useEffect, useRef, useState } from "react";
import type { LessonAudioChunk, LessonAudioTrack } from "../src/teachingEngine/chunkLessonAudio.js";

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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prefetchedRef = useRef<Set<string>>(new Set());

  // If the deeper layers collapse again while one of their chunks is playing, fall back to the
  // last intuition chunk rather than pointing at a chunk that's no longer "available".
  useEffect(() => {
    if (chunkPos >= availableChunks.length) setChunkPos(Math.max(0, availableChunks.length - 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableChunks.length]);

  const currentChunk = availableChunks[chunkPos];

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
      // Web Speech has no live rate change mid-utterance — restart at the new rate.
      window.speechSynthesis.cancel();
      play();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speed]);

  if (!currentChunk) return null;

  return (
    <div className="rounded-lg border border-[var(--color-border)] p-4 space-y-3">
      {mode === "server" && (
        <audio
          ref={audioRef}
          src={chunkAudioUrl(lessonId, currentChunk)}
          onEnded={advance}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
      )}
      <div className="flex items-center gap-3 text-sm">
        <button
          onClick={() => (isPlaying ? pause() : play())}
          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 hover:border-[var(--color-accent)]"
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button
          onClick={skipBack10}
          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 hover:border-[var(--color-accent)]"
        >
          -10s
        </button>
        <select
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value) as Speed)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5"
        >
          <option value={1}>1x</option>
          <option value={1.5}>1.5x</option>
          <option value={2}>2x</option>
        </select>
        <span className="text-[var(--color-text-faint)]">
          {chunkLabel(currentChunk)} ({chunkPos + 1}/{availableChunks.length})
        </span>
      </div>
    </div>
  );
}
