import { Response } from "express";

const clients: Set<Response> = new Set();

export function registerClient(res: Response) {
  clients.add(res);
  res.on("close", () => clients.delete(res));
}

export function broadcast(event: string, data: any) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(payload);
}