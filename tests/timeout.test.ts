import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withTimeout, TimeoutError } from "../src/shared/timeout.js";

describe("withTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves with fn's value when fn finishes well before the timeout", async () => {
    const promise = withTimeout("test op", 1000, async () => "real result");
    await vi.advanceTimersByTimeAsync(10);
    await expect(promise).resolves.toBe("real result");
  });

  it("rejects with a TimeoutError once the timeout elapses, for an fn that never resolves", async () => {
    const neverResolves = () => new Promise<string>(() => {});
    const promise = withTimeout("hanging op", 5000, neverResolves);

    const assertion = expect(promise).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it("the TimeoutError names the label and the configured timeout", async () => {
    const promise = withTimeout("Memory Graph add_memory", 2000, () => new Promise(() => {}));
    const assertion = expect(promise).rejects.toMatchObject({
      name: "TimeoutError",
      label: "Memory Graph add_memory",
      timeoutMs: 2000,
      message: "Memory Graph add_memory timed out after 2000ms",
    });
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
  });

  it("aborts the signal handed to fn once the timeout elapses", async () => {
    let capturedSignal: AbortSignal | undefined;
    const promise = withTimeout("hanging op", 1000, (signal) => {
      capturedSignal = signal;
      return new Promise(() => {});
    });

    expect(capturedSignal!.aborted).toBe(false);
    const assertion = expect(promise).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(capturedSignal!.aborted).toBe(true);
  });

  it("propagates a genuine (non-timeout) error from fn unchanged, distinguishable from a TimeoutError", async () => {
    const promise = withTimeout("failing op", 5000, async () => {
      throw new Error("a real, non-timeout failure");
    });
    await expect(promise).rejects.toThrow("a real, non-timeout failure");
    await expect(promise.catch((e) => e)).resolves.not.toBeInstanceOf(TimeoutError);
  });

  it("does not fire the timeout after fn already resolved (no dangling rejection)", async () => {
    const promise = withTimeout("fast op", 1000, async () => "done");
    await expect(promise).resolves.toBe("done");
    // Advancing well past the timeout after resolution must not throw/reject anything further.
    await vi.advanceTimersByTimeAsync(5000);
  });
});
