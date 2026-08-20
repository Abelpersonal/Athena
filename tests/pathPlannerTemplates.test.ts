import { describe, it, expect } from "vitest";
import { createDecomposeGoalIntoPathValidator } from "../src/orchestrator/templates/decomposeGoalIntoPath.js";
import { createDetermineCrossDomainDependenciesValidator } from "../src/orchestrator/templates/determineCrossDomainDependencies.js";

describe("createDecomposeGoalIntoPathValidator", () => {
  it("accepts a response where every topic references a real domain and tempIds are unique", () => {
    const validate = createDecomposeGoalIntoPathValidator();
    const result = validate({
      domains: [{ tempId: "d1", name: "Math" }],
      topics: [{ tempId: "t1", domainTempId: "d1", topicName: "Linear Algebra", description: "d" }],
    });
    expect(result).toEqual({ success: true });
  });

  it("rejects a response with duplicate domain tempIds", () => {
    const validate = createDecomposeGoalIntoPathValidator();
    const result = validate({
      domains: [
        { tempId: "d1", name: "Math" },
        { tempId: "d1", name: "Math Again" },
      ],
      topics: [{ tempId: "t1", domainTempId: "d1", topicName: "T", description: "d" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a response with duplicate topic tempIds", () => {
    const validate = createDecomposeGoalIntoPathValidator();
    const result = validate({
      domains: [{ tempId: "d1", name: "Math" }],
      topics: [
        { tempId: "t1", domainTempId: "d1", topicName: "T1", description: "d" },
        { tempId: "t1", domainTempId: "d1", topicName: "T2", description: "d" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a topic referencing an unknown domain tempId", () => {
    const validate = createDecomposeGoalIntoPathValidator();
    const result = validate({
      domains: [{ tempId: "d1", name: "Math" }],
      topics: [{ tempId: "t1", domainTempId: "ghost", topicName: "T", description: "d" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("createDetermineCrossDomainDependenciesValidator", () => {
  const topicIds = new Set(["t1", "t2", "t3"]);

  it("accepts a response covering every topic exactly once with valid cross-domain edges", () => {
    const validate = createDetermineCrossDomainDependenciesValidator(topicIds);
    const result = validate({
      dependencies: [
        { topicTempId: "t1", dependsOnTempIds: [] },
        { topicTempId: "t2", dependsOnTempIds: ["t1"] },
        { topicTempId: "t3", dependsOnTempIds: ["t1", "t2"] },
      ],
    });
    expect(result).toEqual({ success: true });
  });

  it("rejects a response that omits a topic", () => {
    const validate = createDetermineCrossDomainDependenciesValidator(topicIds);
    const result = validate({
      dependencies: [
        { topicTempId: "t1", dependsOnTempIds: [] },
        { topicTempId: "t2", dependsOnTempIds: [] },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a response that lists the same topic twice", () => {
    const validate = createDetermineCrossDomainDependenciesValidator(topicIds);
    const result = validate({
      dependencies: [
        { topicTempId: "t1", dependsOnTempIds: [] },
        { topicTempId: "t1", dependsOnTempIds: [] },
        { topicTempId: "t2", dependsOnTempIds: [] },
        { topicTempId: "t3", dependsOnTempIds: [] },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a dependsOnTempIds entry referencing an unknown topic", () => {
    const validate = createDetermineCrossDomainDependenciesValidator(topicIds);
    const result = validate({
      dependencies: [
        { topicTempId: "t1", dependsOnTempIds: ["ghost"] },
        { topicTempId: "t2", dependsOnTempIds: [] },
        { topicTempId: "t3", dependsOnTempIds: [] },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a topic listing itself as its own dependency", () => {
    const validate = createDetermineCrossDomainDependenciesValidator(topicIds);
    const result = validate({
      dependencies: [
        { topicTempId: "t1", dependsOnTempIds: ["t1"] },
        { topicTempId: "t2", dependsOnTempIds: [] },
        { topicTempId: "t3", dependsOnTempIds: [] },
      ],
    });
    expect(result.success).toBe(false);
  });
});
