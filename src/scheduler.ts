import cron from "node-cron";
import { prisma } from "./db";
import { enqueueCheck } from "./queue";

let running = false; // node-cron starts the next tick even if the last one is still running

cron.schedule("* * * * *", async () => {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const isDue = { OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }] };

    const due = await prisma.monitor.findMany({
      where: isDue,
      select: { id: true, url: true, intervalMins: true },
    });

    // Claim each monitor with a compare-and-set: the UPDATE only matches while the
    // monitor is still due, so if two ticks (or two instances) race, exactly one
    // gets count === 1 and the other skips it.
    const claimed = new Map<string, string[]>(); // url -> claimed monitor ids
    for (const m of due) {
      const res = await prisma.monitor.updateMany({
        where: { id: m.id, ...isDue },
        data: { nextCheckAt: new Date(now.getTime() + m.intervalMins * 60_000) },
      });
      if (res.count === 1) claimed.set(m.url, [...(claimed.get(m.url) ?? []), m.id]);
    }

    for (const [url, ids] of claimed) {
      try {
        await enqueueCheck(url); // one job per URL, however many monitors share it
      } catch (err) {
        console.error("Enqueue failed, retrying next tick:", url, err);
        await prisma.monitor.updateMany({ where: { id: { in: ids } }, data: { nextCheckAt: now } });
      }
    }
    if (claimed.size) console.log(`⏱ Scheduled ${claimed.size} URLs`);
  } catch (err) { console.error("Scheduler:", err); }
  finally { running = false; }
});

console.log("⏰ Scheduler started");
