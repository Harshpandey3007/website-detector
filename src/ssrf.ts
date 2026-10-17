import dns from "node:dns/promises";
import net from "node:net";

export type UrlVerdict = { ok: true } | { ok: false; reason: string };

// Every range that is not a normal public unicast address. net.BlockList also
// matches IPv4-mapped IPv6 (::ffff:10.0.0.1) against the IPv4 rules.
const blocked = new net.BlockList();
const V4: Array<[string, number]> = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];
const V6: Array<[string, number]> = [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64],
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
];
for (const [addr, prefix] of V4) blocked.addSubnet(addr, prefix, "ipv4");
for (const [addr, prefix] of V6) blocked.addSubnet(addr, prefix, "ipv6");

export function isPublicIp(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return false;
  return !blocked.check(address, family === 6 ? "ipv6" : "ipv4");
}

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa"];
const ALLOWED_PORTS = new Set(["", "80", "443"]); // URL.port is "" for the default port

export async function isSafeUrl(rawUrl: string): Promise<UrlVerdict> {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return { ok: false, reason: "Invalid URL" }; }
  if (!["http:", "https:"].includes(parsed.protocol))
    return { ok: false, reason: "Only http/https allowed" };
  if (parsed.username || parsed.password)
    return { ok: false, reason: "Credentials in URL not allowed" };
  if (!ALLOWED_PORTS.has(parsed.port))
    return { ok: false, reason: "Only ports 80 and 443 are allowed" };

  // WHATWG URL keeps the brackets on IPv6 literals ("[::1]") and normalises
  // decimal/hex/octal IPv4 forms ("2130706433" -> "127.0.0.1").
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s)))
    return { ok: false, reason: "Localhost blocked" };

  if (net.isIP(host))
    return isPublicIp(host) ? { ok: true } : { ok: false, reason: "Private IP blocked" };

  try {
    const addrs = await dns.lookup(host, { all: true, verbatim: true });
    if (!addrs.length || addrs.some((a) => !isPublicIp(a.address)))
      return { ok: false, reason: "Resolves to a non-public IP" };
  } catch { return { ok: false, reason: "DNS failed" }; }

  return { ok: true };
}

// A page makes hundreds of requests; cache verdicts per host so the browser
// request guard doesn't do a DNS lookup for every image.
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { verdict: UrlVerdict; expires: number }>();

export async function isSafeUrlCached(rawUrl: string): Promise<UrlVerdict> {
  let key: string;
  try { const u = new URL(rawUrl); key = `${u.protocol}//${u.host}`; }
  catch { return { ok: false, reason: "Invalid URL" }; }
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.verdict;
  const verdict = await isSafeUrl(rawUrl);
  if (cache.size > 5_000) cache.clear();
  cache.set(key, { verdict, expires: Date.now() + CACHE_TTL_MS });
  return verdict;
}
