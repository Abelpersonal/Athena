import { describe, it, expect } from "vitest";
import { resolvePendingItems, successfulIds, type OutboxItem, type PostFn } from "../src/offline/outbox.js";

const askItem: OutboxItem = {
  id: "ob_1",
  type: "ask_question",
  url: "/api/lessons/lsn_1/ask",
  payload: { question: "What is entropy?" },
  createdAt: "2026-03-01T00:00:00.000Z",
};
const quizItem: OutboxItem = {
  id: "ob_2",
  type: "quiz_score",
  url: "/api/quiz/lsn_1/score",
  payload: { questions: [], answers: [] },
  createdAt: "2026-03-01T00:01:00.000Z",
};

describe("resolvePendingItems", () => {
  it("resolves every item successfully when the mocked network is up", async () => {
    const calls: Array<{ url: string; payload: unknown }> = [];
    const post: PostFn = async (url, payload) => {
      calls.push({ url, payload });
      return { ok: true, body: { received: true } };
    };

    const results = await resolvePendingItems([askItem, quizItem], post);

    expect(results).toEqual([
      { id: "ob_1", success: true, responseBody: { received: true } },
      { id: "ob_2", success: true, responseBody: { received: true } },
    ]);
    expect(calls).toEqual([
      { url: "/api/lessons/lsn_1/ask", payload: { question: "What is entropy?" } },
      { url: "/api/quiz/lsn_1/score", payload: { questions: [], answers: [] } },
    ]);
  });

  it("a failed item doesn't block the rest of the queue from resolving", async () => {
    const post: PostFn = async (url) => {
      if (url === askItem.url) return { ok: false, error: "Still offline." };
      return { ok: true, body: {} };
    };

    const results = await resolvePendingItems([askItem, quizItem], post);
    expect(results[0]).toMatchObject({ id: "ob_1", success: false, error: "Still offline." });
    expect(results[1]).toMatchObject({ id: "ob_2", success: true });
  });

  it("a post function that throws is caught and reported as a failure, not propagated", async () => {
    const post: PostFn = async () => {
      throw new Error("Network request failed");
    };
    const results = await resolvePendingItems([askItem], post);
    expect(results).toEqual([{ id: "ob_1", success: false, error: "Network request failed" }]);
  });

  it("an empty queue resolves to an empty result set", async () => {
    const post: PostFn = async () => ({ ok: true });
    expect(await resolvePendingItems([], post)).toEqual([]);
  });
});

describe("successfulIds", () => {
  it("returns only the ids that resolved successfully, preserving nothing about the failed ones", () => {
    const ids = successfulIds([
      { id: "a", success: true },
      { id: "b", success: false, error: "nope" },
      { id: "c", success: true },
    ]);
    expect(ids).toEqual(["a", "c"]);
  });
});
