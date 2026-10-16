import dns from "dns/promises";

const PRIVATE = [
  /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./, /^0\./, /^::1$/, /^fc00:/i, /^fe80:/i,
];

export async function isSafeUrl(rawUrl: string) {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return { ok: false, reason: "Invalid URL" }; }
  if (!["http:", "https:"].includes(parsed.protocol))
    return { ok: false, reason: "Only http/https allowed" };

  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local"))
    return { ok: false, reason: "Localhost blocked" };

  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && PRIVATE.some(r => r.test(host)))
    return { ok: false, reason: "Private IP blocked" };

  try {
    const addrs = await dns.lookup(host, { all: true });
    for (const a of addrs)
      if (PRIVATE.some(r => r.test(a.address)))
        return { ok: false, reason: "Resolves to private IP" };
  } catch { return { ok: false, reason: "DNS failed" }; }

  return { ok: true };
}