import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./swagger";
import { register } from "./metrics";
import "dotenv/config";
import "express-async-errors"; // Express 4 drops rejected promises; one bad request would crash the process
import express, { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "./db";
import { isSafeUrl } from "./ssrf";
import { enqueueCheck } from "./queue";
import { PUBLIC_DIR } from "./paths";
import { authenticate, bootstrapAdminKey, hashKey, requireAdmin } from "./auth";
import "./scheduler";
import "./worker";
import "./shutdown";

bootstrapAdminKey().catch((err) => {
  console.error("FATAL: auth bootstrap failed:", err);
  process.exit(1);
});

const MAX_MONITORS_PER_KEY = Number(process.env.MAX_MONITORS_PER_KEY) || 50;

const selectors = z.string().max(500).nullish();
const createMonitorSchema = z.object({
  url: z.string().max(2048),
  name: z.string().trim().min(1).max(100),
  intervalMins: z.number().int().min(15).max(1440),
  sensitivity: z.number().int().min(0).max(100).default(5),
  ignoreSelectors: selectors,
  watchSelectors: selectors,
});

const app = express();
app.set("trust proxy", 1); // Render terminates TLS in front of the app; needed for per-client rate limits
app.use(express.json({ limit: "100kb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
// Screenshot and diff filenames contain 128 random bits, so the URLs are unguessable.
app.use("/public", express.static(PUBLIC_DIR));

// Public routes are matched exactly. The old `OPEN.some(p => req.path.startsWith(p))`
// treated "/" as a prefix of every path, so the API key was never actually checked.
app.get("/health", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));
// --- Metrics Endpoint ---
app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

// --- Swagger Docs ---
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get("/", (_req, res) => {
  res.json({
    name: "Website Change Detector API",
    version: "1.0.0",
    status: "running",
    auth: "Send x-api-key header on all endpoints except /health",
    endpoints: [
      "GET    /health",
      "POST   /monitors",
      "GET    /monitors",
      "GET    /monitors/:id",
      "DELETE /monitors/:id",
      "POST   /monitors/:id/check",
      "GET    /monitors/:id/history",
      "GET    /monitors/:id/compare/:v1/:v2",
      "GET    /alerts",
      "POST   /keys (admin)",
    ],
  });
});

// Everything below requires a valid, non-revoked key.
app.use(authenticate);

const ownerId = (req: Request) => req.auth!.keyId;
// Always look monitors up through the owner, so another key's ids are just "not found".
const findOwned = (req: Request) =>
  prisma.monitor.findFirst({ where: { id: req.params.id, ownerId: ownerId(req) } });

app.post("/keys", requireAdmin, async (req, res) => {
  const name = z.string().trim().min(1).max(100).safeParse(req.body?.name);
  if (!name.success) return res.status(400).json({ error: "name required (1-100 chars)" });
  const apiKey = "wcd_" + crypto.randomBytes(24).toString("base64url");
  await prisma.apiKey.create({ data: { name: name.data, keyHash: hashKey(apiKey) } });
  res.status(201).json({ name: name.data, apiKey, note: "Store this now; it cannot be shown again." });
});

app.post("/monitors", async (req, res) => {
  const parsed = createMonitorSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.issues.map(i => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
  const { name, intervalMins, sensitivity, ignoreSelectors, watchSelectors } = parsed.data;

  const safe = await isSafeUrl(parsed.data.url);
  if (!safe.ok) return res.status(400).json({ error: safe.reason });
  const url = new URL(parsed.data.url).href; // normalised, so equivalent spellings share one fetch

  if (await prisma.monitor.count({ where: { ownerId: ownerId(req) } }) >= MAX_MONITORS_PER_KEY)
    return res.status(403).json({ error: `Monitor limit reached (${MAX_MONITORS_PER_KEY})` });

  const monitor = await prisma.monitor.create({
    data: {
      url, name, intervalMins, sensitivity,
      ignoreSelectors: ignoreSelectors ?? null,
      watchSelectors: watchSelectors ?? null,
      ownerId: ownerId(req),
      nextCheckAt: new Date(Date.now() + intervalMins * 60_000), // first check is queued right below
    },
  });

  await enqueueCheck(url);
  res.status(201).json(monitor);
});

app.get("/monitors", async (req, res) => {
  res.json(await prisma.monitor.findMany({ where: { ownerId: ownerId(req) }, orderBy: { name: "asc" } }));
});

app.get("/monitors/:id", async (req, res) => {
  const m = await findOwned(req);
  if (!m) return res.status(404).json({ error: "Not found" });
  res.json(m);
});

app.delete("/monitors/:id", async (req, res) => {
  // deleteMany: a missing id returns count 0 instead of throwing P2025 (which crashed the process)
  const { count } = await prisma.monitor.deleteMany({ where: { id: req.params.id, ownerId: ownerId(req) } });
  if (!count) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

app.post("/monitors/:id/check", async (req, res) => {
  const m = await findOwned(req);
  if (!m) return res.status(404).json({ error: "Not found" });
  await enqueueCheck(m.url);
  res.json({ queued: true });
});

app.get("/monitors/:id/history", async (req, res) => {
  const m = await findOwned(req);
  if (!m) return res.status(404).json({ error: "Not found" });
  const snaps = await prisma.snapshot.findMany({
    where: { monitorId: m.id },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, contentHash: true, imagePath: true, diffPath: true, createdAt: true },
  });
  res.json(snaps);
});

app.get("/monitors/:id/compare/:v1/:v2", async (req, res) => {
  const m = await findOwned(req);
  if (!m) return res.status(404).json({ error: "Not found" });
  const { v1, v2 } = req.params;
  // Both snapshots must belong to THIS monitor (the old code ignored :id entirely).
  const [a, b] = await Promise.all([
    prisma.snapshot.findFirst({ where: { id: v1, monitorId: m.id } }),
    prisma.snapshot.findFirst({ where: { id: v2, monitorId: m.id } }),
  ]);
  if (!a || !b) return res.status(404).json({ error: "Snapshot not found" });

  const { textDiff } = await import("./differ");
  const td = textDiff(a.textContent, b.textContent);

  res.json({
    v1: { id: a.id, createdAt: a.createdAt, image: a.imagePath, text: a.textContent },
    v2: { id: b.id, createdAt: b.createdAt, image: b.imagePath, text: b.textContent },
    diff: { html: td.html, summary: td.summary, changeRatio: td.changeRatio },
    visualDiff: b.diffPath,
  });
});

app.get("/alerts", async (req, res) => {
  const alerts = await prisma.alert.findMany({
    where: { monitor: { ownerId: ownerId(req) } },
    orderBy: { sentAt: "desc" }, take: 100,
    include: { monitor: { select: { name: true, url: true } } },
  });
  res.json(alerts);
});

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = Number(err?.status ?? err?.statusCode) || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? "Internal error" : String(err.message) });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`🚀 API on http://localhost:${PORT}`));
