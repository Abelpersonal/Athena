import type { CourseLessonLayers } from "../db/schema.js";

export type LessonLayerKey = "intuition" | "mechanics" | "formal" | "application" | "frontier";

export const LESSON_LAYER_ORDER: LessonLayerKey[] = [
  "intuition",
  "mechanics",
  "formal",
  "application",
  "frontier",
];

export interface LessonAudioChunk {
  /** Stable within one lesson: "<layer>-<chunkIndex>". */
  chunkId: string;
  layer: LessonLayerKey;
  chunkIndex: number;
  text: string;
}

export interface LessonAudioTrack {
  lessonId: string;
  chunks: LessonAudioChunk[];
}

/** OpenAI TTS caps `input` at 4096 characters per call; this stays well under that so a chunk maps to a genuinely paragraph/section-sized listening unit, not the longest string that would technically fit. */
const MAX_CHUNK_CHARS = 800;

const SENTENCE_SPLIT_PATTERN = /[^.!?]+[.!?]+(?:\s+|$)/g;

/** Splits one layer's text into paragraph-sized pieces, falling back to grouping whole sentences under the cap when a single paragraph exceeds it — a chunk boundary never lands mid-sentence. */
function splitIntoChunks(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const source = paragraphs.length > 0 ? paragraphs : [text.trim()];

  const chunks: string[] = [];
  for (const paragraph of source) {
    if (paragraph.length <= MAX_CHUNK_CHARS) {
      chunks.push(paragraph);
      continue;
    }

    const sentences = paragraph.match(SENTENCE_SPLIT_PATTERN) ?? [paragraph];
    let current = "";
    for (const sentence of sentences) {
      if (current.length > 0 && (current.length + sentence.length) > MAX_CHUNK_CHARS) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current += sentence;
      }
    }
    if (current.trim()) chunks.push(current.trim());
  }
  return chunks;
}

/**
 * Phase 7.5's chunking step: splits a lesson's five depth layers into paragraph/section-sized
 * pieces suitable for TTS (PRD §5.6's stated granularity), PER LAYER — not the whole lesson
 * flattened into one blob. `AudioPlayer` (components/AudioPlayer.tsx) only ever requests audio
 * for chunks belonging to a layer the learner has actually expanded, keeping "deeper layers on
 * demand" (Phase 7's own UI principle) meaningful for audio too. Pure — no I/O, no provider
 * calls — the resulting `LessonAudioTrack` is the shape both the Stage 1 browser prototype and
 * Stage 2 OpenAI TTS consume identically; only how each CHUNK's audio gets produced differs.
 */
export function chunkLessonAudio(lessonId: string, layers: CourseLessonLayers): LessonAudioTrack {
  const chunks: LessonAudioChunk[] = [];
  for (const layer of LESSON_LAYER_ORDER) {
    const pieces = splitIntoChunks(layers[layer].text);
    pieces.forEach((text, chunkIndex) => {
      chunks.push({ chunkId: `${layer}-${chunkIndex}`, layer, chunkIndex, text });
    });
  }
  return { lessonId, chunks };
}
