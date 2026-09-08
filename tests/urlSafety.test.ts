import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockLookup = vi.fn();
vi.mock("node:dns/promises", () => ({
  lookup: (...args: unknown[]) => mockLookup(...args),
}));

const { isSafeToFetch } = await import("../src/shared/urlSafety.js");

describe("isSafeToFetch (mocked DNS — the private-range logic itself)", () => {
  beforeEach(() => mockLookup.mockReset());

  it("rejects a hostname resolving to an RFC 1918 private address (10.x)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "10.1.2.3", family: 4 }]);
    expect(await isSafeToFetch("http://internal.example.com/")).toBe(false);
  });

  it("rejects a hostname resolving to an RFC 1918 private address (172.16-31.x)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "172.20.0.5", family: 4 }]);
    expect(await isSafeToFetch("http://internal.example.com/")).toBe(false);
  });

  it("rejects a hostname resolving to an RFC 1918 private address (192.168.x)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "192.168.1.1", family: 4 }]);
    expect(await isSafeToFetch("http://internal.example.com/")).toBe(false);
  });

  it("rejects a hostname resolving to loopback (127.x)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    expect(await isSafeToFetch("http://sneaky.example.com/")).toBe(false);
  });

  it("rejects a hostname resolving to link-local, including the cloud-metadata address", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    expect(await isSafeToFetch("http://metadata.example.com/")).toBe(false);
  });

  it("rejects a hostname resolving to IPv6 loopback (::1)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "::1", family: 6 }]);
    expect(await isSafeToFetch("http://sneaky.example.com/")).toBe(false);
  });

  it("rejects a hostname resolving to IPv6 link-local (fe80::/10)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "fe80::1", family: 6 }]);
    expect(await isSafeToFetch("http://sneaky.example.com/")).toBe(false);
  });

  it("rejects a hostname resolving to IPv6 unique local (fc00::/7)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "fd12:3456:789a::1", family: 6 }]);
    expect(await isSafeToFetch("http://sneaky.example.com/")).toBe(false);
  });

  it("rejects an IPv4-mapped IPv6 address whose embedded IPv4 is private", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "::ffff:10.0.0.1", family: 6 }]);
    expect(await isSafeToFetch("http://sneaky.example.com/")).toBe(false);
  });

  it("accepts a hostname resolving only to real public addresses", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "104.20.23.154", family: 4 }]);
    expect(await isSafeToFetch("https://example.com/article")).toBe(true);
  });

  it("rejects when ANY resolved address is private, even if others are public (a hostname can round-robin)", async () => {
    mockLookup.mockResolvedValueOnce([
      { address: "104.20.23.154", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    expect(await isSafeToFetch("http://mixed.example.com/")).toBe(false);
  });

  it("this is the DNS-rebinding case: a plain-looking hostname (not literally 'localhost') that resolves privately is still rejected", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    expect(await isSafeToFetch("http://totally-normal-looking-domain.com/")).toBe(false);
  });

  it("fails closed on a DNS resolution error (NXDOMAIN etc.) rather than treating it as safe", async () => {
    mockLookup.mockRejectedValueOnce(new Error("ENOTFOUND"));
    expect(await isSafeToFetch("http://does-not-exist.invalid/")).toBe(false);
  });

  it("fails closed on a malformed URL", async () => {
    expect(await isSafeToFetch("not a url at all")).toBe(false);
    expect(mockLookup).not.toHaveBeenCalled();
  });
});

describe("isSafeToFetch (real DNS resolution — no mocking)", () => {
  afterEach(() => vi.doUnmock("node:dns/promises"));

  it("resolves a real public hostname and confirms it is NOT flagged as private", async () => {
    vi.doUnmock("node:dns/promises");
    vi.resetModules();
    const { isSafeToFetch: realIsSafeToFetch } = await import("../src/shared/urlSafety.js");
    expect(await realIsSafeToFetch("https://example.com/")).toBe(true);
  });

  it("resolves the real literal loopback address and confirms it IS flagged as private", async () => {
    vi.doUnmock("node:dns/promises");
    vi.resetModules();
    const { isSafeToFetch: realIsSafeToFetch } = await import("../src/shared/urlSafety.js");
    expect(await realIsSafeToFetch("http://127.0.0.1:9999/")).toBe(false);
  });

  it("resolves the real hostname 'localhost' and confirms it IS flagged as private (both its ::1 and 127.0.0.1 addresses)", async () => {
    vi.doUnmock("node:dns/promises");
    vi.resetModules();
    const { isSafeToFetch: realIsSafeToFetch } = await import("../src/shared/urlSafety.js");
    expect(await realIsSafeToFetch("http://localhost:9999/")).toBe(false);
  });
});
