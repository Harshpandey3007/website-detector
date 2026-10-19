import fs from "fs/promises";
import path from "path";
import { Worker, Job } from "bullmq";
import type { Monitor } from "@prisma/client";
import { PUBLIC_DIR } from "./paths";
import { jobsProcessed, changesDetected, alertsSent } from "./metrics";
import { CHECK_QUEUE, connection } from "./queue";
import { prisma } from "./db";
import { fetchPage, extractText, hashText } from "./scraper";
import { textDiff, visualDiff } from "./differ";
import { summarizeChange, NO_CHANGE } from "./ai";
import { notifyChange, notifyStatus, claimAlert } from "./alerts";
import { broadcast } from "./events";

// One change alert per monitor per window. Set ALERT_WINDOW_MINUTES=1 for demos so
// you can trigger several changes back-to-back and still get every alert.
const CHANGE_ALERT_WINDOW_MIN = Number(process.env.ALERT_WINDOW_MINUTES) || 30;
const STATUS_ALERT_WINDOW_MIN = 1440;

const toPublicUrl = (p: string) => "/" + path.relative(PUBLIC_DIR, p).replace(/\\/g, "/");

type Outcome = "unchanged" | "baseline" | "below-threshold" | "noise" | "changed" | "deleted";

async function checkMonitor(
  monitor: Monitor,
  html: string,
  screenshotAbs: string,
): Promise<{ outcome: Outcome; keepScreenshot: boolean }> {
  const markOk = (extra: { lastChangedAt?: Date } = {}) =>
    prisma.monitor.update({
      where: { id: monitor.id },
      data: { status: "OK", lastCheckedAt: new Date(), ...extra },
    });

  try {
    const text = extractText(html, monitor.ignoreSelectors, monitor.watchSelectors);
    const hash = hashText(text);
    const lastSnap = await prisma.snapshot.findFirst({
      where: { monitorId: monitor.id }, orderBy: { createdAt: "desc" },
    });

    if (lastSnap && lastSnap.contentHash === hash) {
      await markOk();
      return { outcome: "unchanged", keepScreenshot: false };
    }

    if (!lastSnap) {
      await prisma.snapshot.create({
        data: { monitorId: monitor.id, contentHash: hash, textContent: text, imagePath: toPublicUrl(screenshotAbs) },
      });
      await markOk();
      return { outcome: "baseline", keepScreenshot: true };
    }

    const td = textDiff(lastSnap.textContent, text);
    const changePercent = td.changeRatio * 100;
    if (changePercent < monitor.sensitivity) {
      await markOk();
      return { outcome: "below-threshold", keepScreenshot: false };
    }

    const oldAbs = path.join(PUBLIC_DIR, lastSnap.imagePath.replace(/^\//, ""));
    const vd = await visualDiff(oldAbs, screenshotAbs);
    const aiSummary = await summarizeChange(lastSnap.textContent, text);
    const summary = aiSummary || td.summary;

    const snapshot = await prisma.snapshot.create({
      data: {
        monitorId: monitor.id, contentHash: hash, textContent: text,
        imagePath: toPublicUrl(screenshotAbs),
        diffPath: vd ? toPublicUrl(vd.diffPath) : null,
      },
    });

    // The AI says it was only timestamps/counters: keep the new baseline, stay quiet.
    if (aiSummary && NO_CHANGE.test(aiSummary)) {
      await markOk();
      return { outcome: "noise", keepScreenshot: true };
    }

    await markOk({ lastChangedAt: new Date() });
    changesDetected.inc();

    broadcast(monitor.ownerId, "change:detected", {
      monitorId: monitor.id, name: monitor.name, url: monitor.url, summary,
      snapshotId: snapshot.id, prevSnapshotId: lastSnap.id, changePercent,
    });

    if (await claimAlert(monitor.id, "change", summary, CHANGE_ALERT_WINDOW_MIN)) {
      const results = await notifyChange({
        monitorId: monitor.id, monitorName: monitor.name, url: monitor.url, summary, changePercent,
        snapshotId: snapshot.id, prevSnapshotId: lastSnap.id, diffImageAbsPath: vd?.diffPath ?? null,
      });
      if (results.some((r) => r.status === "sent")) alertsSent.inc();
    }
    return { outcome: "changed", keepScreenshot: true };
  } catch (err: any) {
    // P2003 = foreign key failed: the monitor was deleted while the page was being fetched.
    if (err?.code === "P2003") {
      console.log(`⚠️ Monitor ${monitor.id} was deleted during fetch. Skipping.`);
      return { outcome: "deleted", keepScreenshot: false };
    }
    throw err;
  }
}

async function processUrl(job: Job<{ url: string }>) {
  const { url } = job.data;
  const monitors = await prisma.monitor.findMany({ where: { url } });
  if (!monitors.length) return { skipped: true };

  for (const m of monitors) broadcast(m.ownerId, "check:started", { monitorId: m.id });

  const scraped = await fetchPage(url);

  if (!scraped.ok) {
    await prisma.monitor.updateMany({ where: { url }, data: { status: scraped.status, lastCheckedAt: new Date() } });
    for (const m of monitors) {
      if (m.status !== scraped.status && await claimAlert(m.id, "status", `Status: ${scraped.status}`, STATUS_ALERT_WINDOW_MIN)) {
        await notifyStatus({ monitorName: m.name, url: m.url, status: scraped.status, reason: scraped.reason });
      }
      broadcast(m.ownerId, "check:finished", { monitorId: m.id, status: scraped.status, outcome: "error" });
    }
    jobsProcessed.inc({ status: scraped.status });
    return { status: scraped.status };
  }

  const html = scraped.html!;
  const screenshotAbs = scraped.screenshotPath!;
  let keepScreenshot = false; // only a stored snapshot references the file

  try {
    for (const monitor of monitors) {
      try {
        const r = await checkMonitor(monitor, html, screenshotAbs);
        keepScreenshot ||= r.keepScreenshot;
        jobsProcessed.inc({ status: "OK" });
        broadcast(monitor.ownerId, "check:finished", { monitorId: monitor.id, status: "OK", outcome: r.outcome });
      } catch (err) {
        broadcast(monitor.ownerId, "check:finished", { monitorId: monitor.id, status: "ERROR", outcome: "error" });
        throw err;
      }
    }
  } finally {
    if (!keepScreenshot) await fs.unlink(screenshotAbs).catch(() => {});
  }
  return { ok: true };
}

export const worker = new Worker(CHECK_QUEUE, processUrl, {
  connection,
  concurrency: 1, // one Chromium at a time keeps memory inside Render's limit
  limiter: { max: 1, duration: 10_000 },
});

worker.on("completed", (j) => console.log(`✅ ${j.data.url}`));
worker.on("failed", (j, e) => console.error(`❌ ${j?.data?.url}`, e.message));
worker.on("error", (e) => console.error("[worker]", e.message));
console.log("👷 Worker started");
