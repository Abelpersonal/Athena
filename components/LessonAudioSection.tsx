"use client";

import { useState } from "react";
import { LayerViewer, type LessonLayers } from "./LayerViewer.js";
import { AudioPlayer, type AudioPlayerMode } from "./AudioPlayer.js";
import type { LessonAudioTrack } from "../src/teachingEngine/chunkLessonAudio.js";

/**
 * Replaces Phase 7's `<PlaceholderPanel label="Voice playback" note="Phase 7.5" />` in
 * `app/lessons/[id]/page.tsx`. The one piece of shared state `AudioPlayer` and `LayerViewer` both
 * need — whether the "Go deeper" disclosure is open — lives here, in the smallest client
 * component that can hold it, rather than inside either of those two components themselves.
 */
export function LessonAudioSection({
  lessonId,
  layers,
  track,
  mode,
}: {
  lessonId: string;
  layers: LessonLayers;
  track: LessonAudioTrack;
  mode: AudioPlayerMode;
}) {
  const [deeperLayersExpanded, setDeeperLayersExpanded] = useState(false);

  return (
    <div className="space-y-4">
      <AudioPlayer lessonId={lessonId} track={track} mode={mode} deeperLayersExpanded={deeperLayersExpanded} />
      <LayerViewer layers={layers} onDeeperLayersToggle={setDeeperLayersExpanded} />
    </div>
  );
}
