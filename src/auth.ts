import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "./db";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { auth?: { keyId: string; isAdmin: boolean } }
  }
}

// Keys are stored as SHA-256 hashes, so a leaked database doesn't leak working keys.
// Looking the hash up by its unique index also means there's no secret-dependent
// string comparison for a timing attack to exploit.
export const hashKey = (key: string) => crypto.createHash("sha256").update(key).digest("hex");

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const key = req.header("x-api-key");
  if (!key) return res.status(401).json({ error: "Unauthorized" });
  const row = await prisma.apiKey.findUnique({ where: { keyHash: hashKey(key) } });
  if (!row || row.revokedAt) return res.status(401).json({ error: "Unauthorized" });
  req.auth = { keyId: row.id, isAdmin: row.isAdmin };
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.isAdmin) return res.status(403).json({ error: "Forbidden" });
  next();
}

/** Turns the API_KEY env var into the admin key and adopts pre-existing monitors. */
export async function bootstrapAdminKey() {
  const raw = process.env.API_KEY;
  if (!raw) throw new Error("API_KEY must be set"); // fail closed, never run unauthenticated
  if (raw.length < 16 || raw === "secret-demo-key")
    console.warn("WARNING: API_KEY is short or is the public demo key from the README. Rotate it.");

  const keyHash = hashKey(raw);
  const admin = await prisma.apiKey.upsert({
    where: { keyHash },
    update: { isAdmin: true, revokedAt: null },
    create: { name: "bootstrap-admin", keyHash, isAdmin: true },
  });

  // Rotation: revoke earlier bootstrap keys and hand their monitors to the new one.
  const old = await prisma.apiKey.findMany({
    where: { name: "bootstrap-admin", keyHash: { not: keyHash }, revokedAt: null },
    select: { id: true },
  });
  if (old.length) {
    const ids = old.map((k) => k.id);
    await prisma.monitor.updateMany({ where: { ownerId: { in: ids } }, data: { ownerId: admin.id } });
    await prisma.apiKey.updateMany({ where: { id: { in: ids } }, data: { revokedAt: new Date() } });
  }

  // Monitors created before per-key ownership existed.
  await prisma.monitor.updateMany({ where: { ownerId: null }, data: { ownerId: admin.id } });
}
