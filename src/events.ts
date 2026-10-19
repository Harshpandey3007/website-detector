import type { Response } from "express";


interface Client { res: Response; ownerId: string }
const clients = new Set<Client>();

export function registerClient(res: Response, ownerId: string) {
  const client: Client = { res, ownerId };
  clients.add(client);
  res.on("close", () => clients.delete(client));
}

export function broadcast(ownerId: string | null | undefined, event: string, data: unknown) {
  if (!ownerId) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    if (c.ownerId !== ownerId) continue;
    try { c.res.write(payload); } catch { clients.delete(c); }
  }
}

// A comment line every 25s keeps proxies (Render, nginx, Cloudflare) from closing idle streams.
setInterval(() => {
  for (const c of clients) {
    try { c.res.write(": ping\n\n"); } catch { clients.delete(c); }
  }
}, 25_000).unref();
