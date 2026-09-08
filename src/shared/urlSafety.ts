import { lookup } from "node:dns/promises";
import { BlockList } from "node:net";

/**
 * SSRF guard for every outbound source fetch (`extraction/fetchAndClean.ts`'s HTTP fetch — which
 * the PDF path shares, since it's the same `fetch()` call just routed differently after the
 * response comes back — and its YouTube-URL routing check, which runs before any HTTP request at
 * all). Checked against the RESOLVED IP address, never just the hostname string — a hostname-only
 * check ("is this literally `localhost`?") is trivially bypassed by a DNS-rebinding domain that
 * resolves to a private address, so this always resolves first via a real DNS lookup (`node:dns`)
 * and inspects EVERY address returned, not just the first — a hostname can legitimately round-robin
 * between a public and a private address.
 *
 * Beyond the standard ranges (RFC 1918 private IPv4, IPv4 loopback/link-local — which includes the
 * 169.254.169.254 cloud-metadata address — and IPv6 loopback/link-local), this also blocks IPv6
 * unique local addresses (`fc00::/7`, RFC 4193's IPv6 analogue of RFC 1918), the IPv4 "this
 * network" range (`0.0.0.0/8` — several network stacks treat a literal `0.0.0.0` fetch as
 * localhost), and the IPv6 unspecified address (`::`) — a guard omitting these would have an
 * obvious bypass. IPv4-mapped IPv6 addresses (`::ffff:x.x.x.x`) need no separate rule: confirmed
 * live that `node:net`'s `BlockList` automatically unwraps and checks these against the IPv4 rules
 * already registered below, rather than needing every IPv4 range duplicated as an
 * IPv6 `::ffff:.../96` rule.
 */
const blockList = new BlockList();
// IPv4
blockList.addSubnet("10.0.0.0", 8, "ipv4"); // RFC 1918
blockList.addSubnet("172.16.0.0", 12, "ipv4"); // RFC 1918
blockList.addSubnet("192.168.0.0", 16, "ipv4"); // RFC 1918
blockList.addSubnet("127.0.0.0", 8, "ipv4"); // loopback
blockList.addSubnet("169.254.0.0", 16, "ipv4"); // link-local (includes the 169.254.169.254 cloud-metadata address)
blockList.addSubnet("0.0.0.0", 8, "ipv4"); // "this network" — some stacks treat this as localhost
// IPv6
blockList.addAddress("::1", "ipv6"); // loopback
blockList.addAddress("::", "ipv6"); // unspecified
blockList.addSubnet("fe80::", 10, "ipv6"); // link-local
blockList.addSubnet("fc00::", 7, "ipv6"); // unique local (RFC 4193)

function familyName(family: number): "ipv4" | "ipv6" | null {
  if (family === 4) return "ipv4";
  if (family === 6) return "ipv6";
  return null;
}

/**
 * Resolves `url`'s hostname and returns `false` if ANY resolved address falls in a private/
 * reserved range — this is what catches DNS rebinding (a hostname that legitimately resolves to a
 * private address, not just a literal `localhost`/`127.0.0.1` string). Fails CLOSED: a hostname
 * that fails to resolve at all (NXDOMAIN, a malformed URL, a real DNS error) is treated as unsafe
 * to fetch — this function's only job is deciding fetch-worthiness, not distinguishing "doesn't
 * exist" from "resolves privately" for the caller, both degrade the exact same way (excluded,
 * logged, not fetched).
 */
export async function isSafeToFetch(url: string): Promise<boolean> {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  if (!hostname) return false;

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    return false;
  }
  if (addresses.length === 0) return false;

  return addresses.every((a) => {
    const family = familyName(a.family);
    if (!family) return true; // dns.lookup only ever reports family 4 or 6; unreachable in practice
    return !blockList.check(a.address, family);
  });
}
