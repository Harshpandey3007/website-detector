import { PUBLIC_DIR } from "./paths";
import { jobsProcessed, changesDetected, alertsSent } from "./metrics";
import fs from "fs/promises";
import { Worker, Job } from "bullmq";
import { CHECK_QUEUE, connection } from "./queue";
import { prisma } from "./db";
import { fetchPage, extractText, hashText } from "./scraper";
import { textDiff, visualDiff } from "./differ";
import { summarizeChange } from "./ai";
import { sendDiscord, claimAlert } from "./alerts";
import path from "path";


const toPublicUrl = (p: string) => "/" + path.relative(PUBLIC_DIR, p).replace(/\\/g, "/");

async function processUrl(job: Job<{ url: string }>) {
  const { url } = job.data;
  const monitors = await prisma.monitor.findMany({ where: { url } });
  if (!monitors.length) return { skipped: true };

  const scraped = await fetchPage(url);

  if (!scraped.ok) {
    await prisma.monitor.updateMany({
      where: { url },
      data: { status: scraped.status, lastCheckedAt: new Date() },
    });
    for (const m of monitors) {
      if (m.status !== scraped.status && await claimAlert(m.id, "status", `Status: ${scraped.status}`, 1440)) {
        await sendDiscord(`⚠️ **${m.name}** → ${scraped.status}`);
      }
    }
    return { status: scraped.status };
  }

  const html = scraped.html!;
  const screenshotAbs = scraped.screenshotPath!;
  let keepScreenshot = false; // only a stored snapshot references the file

  for (const monitor of monitors) {
    try {
      const text = extractText(html, monitor.ignoreSelectors, monitor.watchSelectors);
      const hash = hashText(text);
      const lastSnap = await prisma.snapshot.findFirst({
        where: { monitorId: monitor.id }, orderBy: { createdAt: "desc" },
      });

      if (lastSnap && lastSnap.contentHash === hash) {
        await prisma.monitor.update({
          where: { id: monitor.id },
          data: { status: "OK", lastCheckedAt: new Date() },
        });
        continue;
        jobsProcessed.inc({ status: "OK" });
      }

      if (!lastSnap) {
        keepScreenshot = true;
        await prisma.snapshot.create({
          data: {
            monitorId: monitor.id, contentHash: hash,
            textContent: text, imagePath: toPublicUrl(screenshotAbs),
          },
        });
        await prisma.monitor.update({
          where: { id: monitor.id },
          data: { status: "OK", lastCheckedAt: new Date() },
        });
        continue;
        jobsProcessed.inc({ status: "OK" });
      }

      const td = textDiff(lastSnap.textContent, text);
      if (td.changeRatio * 100 < monitor.sensitivity) {
        await prisma.monitor.update({
          where: { id: monitor.id },
          data: { status: "OK", lastCheckedAt: new Date() },
        });
        continue;
        jobsProcessed.inc({ status: "OK" });
      }

      keepScreenshot = true;
      const oldAbs = path.join(PUBLIC_DIR, lastSnap.imagePath.replace(/^\//, ""));
      const vd = await visualDiff(oldAbs, screenshotAbs);
      const aiSummary = await summarizeChange(lastSnap.textContent, text);
      const finalSummary = aiSummary || td.summary;

      const snapshot = await prisma.snapshot.create({
        data: {
          monitorId: monitor.id, contentHash: hash,
          textContent: text, imagePath: toPublicUrl(screenshotAbs),
          diffPath: vd ? toPublicUrl(vd.diffPath) : null,
        },
      });

      await prisma.monitor.update({
        where: { id: monitor.id },
        data: { status: "OK", lastCheckedAt: new Date(), lastChangedAt: new Date() },
      });

      if (await claimAlert(monitor.id, "change", finalSummary, 30)) {
        await sendDiscord(`🔔 **${monitor.name}** changed\n${finalSummary}\n${monitor.url}`);
      }
    } catch (err: any) {
      // P2003 means Foreign Key constraint failed (monitor was deleted while fetching)
      if (err.code === 'P2003') {
        console.log(`⚠️ Monitor ${monitor.id} was deleted during fetch. Skipping.`);
      } else {
        throw err;
      }
    }
  }
    if (!keepScreenshot) {
    await fs.unlink(screenshotAbs).catch(() => {});
  }
  return { ok: true };
  
}

export const worker = new Worker(CHECK_QUEUE, processUrl, {
  connection, concurrency: 1, // Claude set this to 1 to prevent OOM on Render
  limiter: { max: 1, duration: 10_000 },
});

worker.on("completed", j => console.log(`✅ ${j.data.url}`));
worker.on("failed", (j, e) => console.error(`❌ ${j?.data?.url}`, e.message));
console.log("👷 Worker started");
worker.on("error", (e) => console.error("[worker]", e.message));