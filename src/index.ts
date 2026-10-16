import "dotenv/config";
import express from "express";
import path from "path";
import { prisma } from "./db";
import { isSafeUrl } from "./ssrf";
import { checkQueue } from "./queue";
import "./scheduler";
import "./worker";

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use("/public", express.static(path.join(process.cwd(), "public")));

const OPEN = ["/health"];
app.use((req, res, next) => {
  if (OPEN.some(p => req.path.startsWith(p))) return next();
  if (req.header("x-api-key") !== process.env.API_KEY)
    return res.status(401).json({ error: "Unauthorized" });
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

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
    ],
  });
});

app.post("/monitors", async (req, res) => {
  const { url, name, intervalMins, sensitivity, ignoreSelectors, watchSelectors } = req.body;
  if (!url || !name || !intervalMins) return res.status(400).json({ error: "url, name, intervalMins required" });
  if (intervalMins < 15 || intervalMins > 1440) return res.status(400).json({ error: "intervalMins must be 15–1440" });

  const safe = await isSafeUrl(url);
  if (!safe.ok) return res.status(400).json({ error: safe.reason });

  const monitor = await prisma.monitor.create({
    data: {
      url, name, intervalMins,
      sensitivity: sensitivity ?? 5,
      ignoreSelectors: ignoreSelectors ?? null,
      watchSelectors: watchSelectors ?? null,
    },
  });

  await checkQueue.add("check", { url }, { jobId: url, attempts: 3 });
  res.status(201).json(monitor);
});

app.get("/monitors", async (_req, res) => {
  res.json(await prisma.monitor.findMany({ orderBy: { name: "asc" } }));
});

app.get("/monitors/:id", async (req, res) => {
  const m = await prisma.monitor.findUnique({ where: { id: req.params.id } });
  if (!m) return res.status(404).json({ error: "Not found" });
  res.json(m);
});

app.delete("/monitors/:id", async (req, res) => {
  try {
    await prisma.monitor.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Not found" });
  }
});
app.post("/monitors/:id/check", async (req, res) => {
  const m = await prisma.monitor.findUnique({ where: { id: req.params.id } });
  if (!m) return res.status(404).json({ error: "Not found" });
  await checkQueue.add("check", { url: m.url }, { jobId: m.url, attempts: 3 });
  res.json({ queued: true });
});

app.get("/monitors/:id/history", async (req, res) => {
  const snaps = await prisma.snapshot.findMany({
    where: { monitorId: req.params.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, contentHash: true, imagePath: true, diffPath: true, createdAt: true },
  });
  res.json(snaps);
});

app.get("/monitors/:id/compare/:v1/:v2", async (req, res) => {
  const { v1, v2 } = req.params;
  const [a, b] = await Promise.all([
    prisma.snapshot.findUnique({ where: { id: v1 } }),
    prisma.snapshot.findUnique({ where: { id: v2 } }),
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

app.get("/alerts", async (_req, res) => {
  const alerts = await prisma.alert.findMany({
    orderBy: { sentAt: "desc" }, take: 100,
    include: { monitor: { select: { name: true, url: true } } },
  });
  res.json(alerts);
});

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("Error:", err.message);
  res.status(500).json({ error: err.message || "Internal error" });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`🚀 API on http://localhost:${PORT}`));