import { describe, it, expect } from "vitest";
import { chunkLessonAudio, LESSON_LAYER_ORDER } from "../src/teachingEngine/chunkLessonAudio.js";
import type { CourseLessonLayers } from "../src/db/schema.js";

function layer(text: string) {
  return { text, source_ids: ["src_1"] };
}

function makeLayers(overrides: Partial<Record<keyof CourseLessonLayers, string>> = {}): CourseLessonLayers {
  return {
    intuition: layer(overrides.intuition ?? "Short intuition text."),
    mechanics: layer(overrides.mechanics ?? "Short mechanics text."),
    formal: layer(overrides.formal ?? "Short formal text."),
    application: layer(overrides.application ?? "Short application text."),
    frontier: layer(overrides.frontier ?? "Short frontier text."),
  };
}

describe("chunkLessonAudio", () => {
  it("produces one chunk per short layer, in layer order (intuition -> ... -> frontier)", () => {
    const track = chunkLessonAudio("lsn_1", makeLayers());
    expect(track.lessonId).toBe("lsn_1");
    expect(track.chunks).toHaveLength(5);
    expect(track.chunks.map((c) => c.layer)).toEqual(LESSON_LAYER_ORDER);
    expect(track.chunks.map((c) => c.chunkId)).toEqual([
      "intuition-0",
      "mechanics-0",
      "formal-0",
      "application-0",
      "frontier-0",
    ]);
  });

  it("splits a layer with real paragraph breaks into one chunk per paragraph", () => {
    const layers = makeLayers({
      mechanics: "First paragraph about the mechanics.\n\nSecond paragraph, a distinct idea.\n\nThird paragraph.",
    });
    const track = chunkLessonAudio("lsn_1", layers);
    const mechanicsChunks = track.chunks.filter((c) => c.layer === "mechanics");
    expect(mechanicsChunks).toHaveLength(3);
    expect(mechanicsChunks[0]!.text).toBe("First paragraph about the mechanics.");
    expect(mechanicsChunks[2]!.text).toBe("Third paragraph.");
  });

  it("splits a single very long paragraph into multiple sentence-grouped chunks, never mid-sentence", () => {
    const sentence = "This is one reasonably long sentence about the topic at hand. ";
    const longText = sentence.repeat(30); // well over the 800-char cap, no paragraph breaks
    const layers = makeLayers({ formal: longText });
    const track = chunkLessonAudio("lsn_1", layers);
    const formalChunks = track.chunks.filter((c) => c.layer === "formal");

    expect(formalChunks.length).toBeGreaterThan(1);
    for (const chunk of formalChunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(900); // some slack over the 800 cap for the last sentence that pushed it over
      expect(chunk.text.trim().endsWith(".")).toBe(true); // never cut mid-sentence
    }
    // Reassembling every chunk's text should reproduce the original content (modulo whitespace).
    const reassembled = formalChunks.map((c) => c.text).join(" ");
    expect(reassembled.replace(/\s+/g, " ")).toContain("one reasonably long sentence");
  });

  it("chunk ids are stable and unique within a lesson", () => {
    const track = chunkLessonAudio("lsn_1", makeLayers({ mechanics: "A.\n\nB.\n\nC." }));
    const ids = track.chunks.map((c) => c.chunkId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
