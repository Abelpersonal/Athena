import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockCallTool = vi.fn();
const mockClose = vi.fn().mockResolvedValue(undefined);

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(function MockClient() {
    return { connect: mockConnect, callTool: mockCallTool, close: mockClose };
  }),
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(function MockStreamableHTTPClientTransport() {
    return {};
  }),
}));

const { GraphitiMCPClient } = await import("../src/memoryGraph/graphitiClient.js");
const { writeTopic, writeSubtopicFacts, getTopicHistory, writeMasteryUpdate } = await import(
  "../src/memoryGraph/index.js"
);

function toolResult(data: unknown): { isError: false; content: Array<{ type: "text"; text: string }> } {
  return { isError: false, content: [{ type: "text", text: JSON.stringify(data) }] };
}

describe("memoryGraph", () => {
  beforeEach(() => {
    mockConnect.mockReset().mockResolvedValue(undefined);
    mockCallTool.mockReset();
    mockClose.mockClear();
  });

  describe("writeTopic", () => {
    it("writes a topic episode (add_memory) and one add_triplet edge per prerequisite", async () => {
      mockCallTool.mockResolvedValue(toolResult({ message: "ok" }));
      const client = new GraphitiMCPClient();

      await writeTopic("crs_123", "Special Relativity", ["Algebra", "Vectors"], client);

      expect(mockCallTool).toHaveBeenCalledTimes(3);

      const [episodeCall, edgeCall1, edgeCall2] = mockCallTool.mock.calls.map((c) => c[0]);
      expect(episodeCall).toMatchObject({
        name: "add_memory",
        arguments: expect.objectContaining({
          name: "Course: Special Relativity",
          source: "text",
          source_description: expect.stringContaining("crs_123"),
        }),
      });
      expect(episodeCall.arguments.episode_body).toContain("Special Relativity");
      expect(episodeCall.arguments.episode_body).toContain("Algebra");
      expect(episodeCall.arguments.episode_body).toContain("Vectors");

      expect(edgeCall1).toMatchObject({
        name: "add_triplet",
        arguments: {
          source_node_name: "Special Relativity",
          edge_name: "REQUIRES_PREREQUISITE",
          target_node_name: "Algebra",
        },
      });
      expect(edgeCall2).toMatchObject({
        name: "add_triplet",
        arguments: {
          source_node_name: "Special Relativity",
          edge_name: "REQUIRES_PREREQUISITE",
          target_node_name: "Vectors",
        },
      });
    });

    it("still writes the topic episode when there are no prerequisites (no add_triplet calls)", async () => {
      mockCallTool.mockResolvedValue(toolResult({ message: "ok" }));
      const client = new GraphitiMCPClient();

      await writeTopic("crs_456", "Photosynthesis", [], client);

      expect(mockCallTool).toHaveBeenCalledTimes(1);
      expect(mockCallTool.mock.calls[0]![0]).toMatchObject({ name: "add_memory" });
    });

    it("degrades gracefully (resolves, logs) when the graph server is unreachable", async () => {
      mockConnect.mockRejectedValue(new Error("ECONNREFUSED"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const client = new GraphitiMCPClient();

      await expect(writeTopic("crs_789", "Thermodynamics", ["Calculus"], client)).resolves.toBeUndefined();

      expect(mockCallTool).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe("writeSubtopicFacts", () => {
    it("writes one add_memory episode per key point, each tagged with its source_id", async () => {
      mockCallTool.mockResolvedValue(toolResult({ message: "ok" }));
      const client = new GraphitiMCPClient();

      await writeSubtopicFacts(
        "crs_123",
        "sub-a",
        [
          { point: "Light speed is constant in all inertial frames.", source_id: "src_1" },
          { point: "Simultaneity is relative.", source_id: "src_2" },
        ],
        client
      );

      expect(mockCallTool).toHaveBeenCalledTimes(2);
      const calls = mockCallTool.mock.calls.map((c) => c[0]);
      expect(calls[0]).toMatchObject({
        name: "add_memory",
        arguments: expect.objectContaining({
          name: "Fact: sub-a",
          source: "json",
          source_description: expect.stringContaining("src_1"),
        }),
      });
      expect(JSON.parse(calls[0].arguments.episode_body)).toEqual({
        point: "Light speed is constant in all inertial frames.",
        source_id: "src_1",
      });
      expect(JSON.parse(calls[1].arguments.episode_body)).toEqual({
        point: "Simultaneity is relative.",
        source_id: "src_2",
      });
    });

    it("does nothing when there are no key points (no tool calls)", async () => {
      const client = new GraphitiMCPClient();
      await writeSubtopicFacts("crs_123", "sub-a", [], client);
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("degrades gracefully on a per-fact failure — one bad write doesn't stop the rest", async () => {
      mockCallTool
        .mockRejectedValueOnce(new Error("write failed"))
        .mockResolvedValueOnce(toolResult({ message: "ok" }));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const client = new GraphitiMCPClient();

      await expect(
        writeSubtopicFacts(
          "crs_123",
          "sub-a",
          [
            { point: "First point.", source_id: "src_1" },
            { point: "Second point.", source_id: "src_2" },
          ],
          client
        )
      ).resolves.toBeUndefined();

      expect(mockCallTool).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe("writeMasteryUpdate", () => {
    it("writes one add_memory episode per call — a new dated fact, not an overwrite", async () => {
      mockCallTool.mockResolvedValue(toolResult({ message: "ok" }));
      const client = new GraphitiMCPClient();

      await writeMasteryUpdate("lsn_1", "knowledge", 0.72, "Quiz session covering tier(s) — recall: 0.80.", client);

      expect(mockCallTool).toHaveBeenCalledTimes(1);
      const call = mockCallTool.mock.calls[0]![0];
      expect(call).toMatchObject({
        name: "add_memory",
        arguments: expect.objectContaining({
          name: "Mastery: lsn_1 (knowledge)",
          source: "text",
          source_description: expect.stringContaining("lsn_1"),
        }),
      });
      expect(call.arguments.episode_body).toContain("0.72");
      expect(call.arguments.episode_body).toContain("Knowledge");
    });

    it("distinguishes 'experience' updates from 'knowledge' updates in the episode name and body", async () => {
      mockCallTool.mockResolvedValue(toolResult({ message: "ok" }));
      const client = new GraphitiMCPClient();

      await writeMasteryUpdate("lsn_2", "experience", 0.5, "Practice attempt 1 (project) on module.", client);

      const call = mockCallTool.mock.calls[0]![0];
      expect(call.arguments.name).toBe("Mastery: lsn_2 (experience)");
      expect(call.arguments.episode_body).toContain("Experience");
    });

    it("degrades gracefully (resolves, logs) when the graph server is unreachable", async () => {
      mockConnect.mockRejectedValue(new Error("ECONNREFUSED"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const client = new GraphitiMCPClient();

      await expect(writeMasteryUpdate("lsn_3", "knowledge", 0.3, "detail", client)).resolves.toBeUndefined();

      expect(mockCallTool).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe("getTopicHistory", () => {
    it("combines search_nodes, search_memory_facts, and get_episodes into one result", async () => {
      mockCallTool.mockImplementation(async (args: { name: string }) => {
        if (args.name === "search_nodes") {
          return toolResult({
            message: "ok",
            nodes: [
              {
                uuid: "n1",
                name: "Special Relativity",
                labels: ["Topic"],
                created_at: "2026-01-01T00:00:00Z",
                summary: "A topic node",
                group_id: "main",
                attributes: {},
              },
            ],
          });
        }
        if (args.name === "search_memory_facts") {
          return toolResult({
            message: "ok",
            facts: [
              {
                uuid: "e1",
                name: "REQUIRES_PREREQUISITE",
                fact: '"Special Relativity" requires prior knowledge of "Algebra".',
                source_node_uuid: "n1",
                target_node_uuid: "n2",
                group_id: "main",
                created_at: "2026-01-01T00:00:00Z",
                valid_at: "2026-01-01T00:00:00Z",
                invalid_at: null,
              },
            ],
          });
        }
        if (args.name === "get_episodes") {
          return toolResult({
            message: "ok",
            episodes: [
              {
                uuid: "ep1",
                name: "Course: Special Relativity",
                content: "...",
                created_at: "2026-01-01T00:00:00Z",
                source: "text",
                source_description: "Teacher Course Builder",
                group_id: "main",
              },
            ],
          });
        }
        throw new Error(`unexpected tool ${args.name}`);
      });
      const client = new GraphitiMCPClient();

      const history = await getTopicHistory("Special Relativity", client);

      expect(history.error).toBeUndefined();
      expect(history.nodes).toHaveLength(1);
      expect(history.nodes[0]!.name).toBe("Special Relativity");
      expect(history.facts).toHaveLength(1);
      expect(history.episodes).toHaveLength(1);
    });

    it("returns an error field (not a throw) when the graph is unreachable", async () => {
      mockConnect.mockRejectedValue(new Error("ECONNREFUSED"));
      const client = new GraphitiMCPClient();

      const history = await getTopicHistory("Anything", client);

      expect(history).toEqual({ nodes: [], facts: [], episodes: [], error: expect.any(String) });
    });
  });
});
