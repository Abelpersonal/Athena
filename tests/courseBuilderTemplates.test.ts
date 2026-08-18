import { describe, it, expect } from "vitest";
import { createSequenceModulesValidator } from "../src/orchestrator/templates/sequenceModules.js";
import { createWriteLessonMetadataValidator } from "../src/orchestrator/templates/writeLessonMetadata.js";

describe("createSequenceModulesValidator", () => {
  const subtopicIds = new Set(["s1", "s2"]);

  it("accepts a response covering every subtopic exactly once with valid edges", () => {
    const validate = createSequenceModulesValidator(subtopicIds);
    const result = validate({
      modules: [
        { tempId: "m1", subtopicIds: ["s1"], prerequisiteOfTempIds: ["m2"] },
        { tempId: "m2", subtopicIds: ["s2"], prerequisiteOfTempIds: [] },
      ],
    });
    expect(result).toEqual({ success: true });
  });

  it("rejects a response that omits a subtopic id", () => {
    const validate = createSequenceModulesValidator(subtopicIds);
    const result = validate({ modules: [{ tempId: "m1", subtopicIds: ["s1"], prerequisiteOfTempIds: [] }] });
    expect(result.success).toBe(false);
  });

  it("rejects a response that assigns the same subtopic id to two modules", () => {
    const validate = createSequenceModulesValidator(subtopicIds);
    const result = validate({
      modules: [
        { tempId: "m1", subtopicIds: ["s1", "s2"], prerequisiteOfTempIds: [] },
        { tempId: "m2", subtopicIds: ["s2"], prerequisiteOfTempIds: [] },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a response referencing an unknown subtopic id", () => {
    const validate = createSequenceModulesValidator(subtopicIds);
    const result = validate({
      modules: [
        { tempId: "m1", subtopicIds: ["s1", "does-not-exist"], prerequisiteOfTempIds: [] },
        { tempId: "m2", subtopicIds: ["s2"], prerequisiteOfTempIds: [] },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a prerequisiteOfTempIds edge pointing at an unknown module tempId", () => {
    const validate = createSequenceModulesValidator(subtopicIds);
    const result = validate({
      modules: [
        { tempId: "m1", subtopicIds: ["s1"], prerequisiteOfTempIds: ["ghost"] },
        { tempId: "m2", subtopicIds: ["s2"], prerequisiteOfTempIds: [] },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("createWriteLessonMetadataValidator", () => {
  const moduleTempIds = new Set(["m1"]);
  const subtopicIds = new Set(["s1"]);

  it("accepts a response covering every module and subtopic exactly once", () => {
    const validate = createWriteLessonMetadataValidator(moduleTempIds, subtopicIds);
    const result = validate({
      modules: [{ tempId: "m1", title: "T", description: "D" }],
      lessons: [{ subtopicId: "s1", title: "T", description: "D", estimatedDuration: "5 min" }],
    });
    expect(result).toEqual({ success: true });
  });

  it("rejects a response that omits a module tempId", () => {
    const validate = createWriteLessonMetadataValidator(moduleTempIds, subtopicIds);
    const result = validate({ modules: [], lessons: [{ subtopicId: "s1", title: "T", description: "D", estimatedDuration: "5 min" }] });
    expect(result.success).toBe(false);
  });

  it("rejects a response that omits a subtopic id from lessons", () => {
    const validate = createWriteLessonMetadataValidator(moduleTempIds, subtopicIds);
    const result = validate({ modules: [{ tempId: "m1", title: "T", description: "D" }], lessons: [] });
    expect(result.success).toBe(false);
  });
});
