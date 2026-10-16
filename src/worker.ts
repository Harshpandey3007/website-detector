import { Worker, Job } from "bullmq";
import { CHECK_QUEUE, connection } from "./queue";
import { prisma } from "./db";
import { fetchPage, extractText, hashText } from "./scraper";
import { textDiff, visualDiff } from "./differ";
import { sendDiscord, shouldSendAlert, recordAlert } from "./alerts";
import path from "path";

const PUBLIC_DIR = path.join(process.cwd(), "public");
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
      if (m.status !== scraped.status && await shouldSendAlert(m.id, 1440)) {
        await recordAlert(m.id, `Status → ${scraped.status}`);
        await sendDiscord(`⚠️ **${m.name}** → ${scraped.status}`);
      }
    }
    return { status: scraped.status };
  }

  const html = scraped.html!;
  const screenshotAbs = scraped.screenshotPath!;

  for (const monitor of monitors) {
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
    }

    if (!lastSnap) {
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
    }

    const td = textDiff(lastSnap.textContent, text);
    if (td.changeRatio * 100 < monitor.sensitivity) {
      await prisma.monitor.update({
        where: { id: monitor.id },
        data: { status: "OK", lastCheckedAt: new Date() },
      });
      continue;
    }

    const oldAbs = path.join(PUBLIC_DIR, lastSnap.imagePath.replace(/^\//, ""));
    const vd = await visualDiff(oldAbs, screenshotAbs);

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

    if (await shouldSendAlert(monitor.id, 30)) {
      await recordAlert(monitor.id, td.summary);
      await sendDiscord(`🔔 **${monitor.name}** changed\n${td.summary}\n${monitor.url}`);
    }
  }
  return { ok: true };
}

export const worker = new Worker(CHECK_QUEUE, processUrl, {
  connection, concurrency: 3,
  limiter: { max: 1, duration: 10_000 },
});

worker.on("completed", j => console.log(`✅ ${j.data.url}`));
worker.on("failed", (j, e) => console.error(`❌ ${j?.data?.url}`, e.message));
console.log("👷 Worker started");