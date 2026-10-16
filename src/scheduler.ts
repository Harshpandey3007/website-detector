import cron from "node-cron";
import { prisma } from "./db";
import { checkQueue } from "./queue";

cron.schedule("* * * * *", async () => {
  try {
    const now = new Date();
    const monitors = await prisma.monitor.findMany();
    const due = new Set<string>();

    for (const m of monitors) {
      if (!m.lastCheckedAt) { due.add(m.url); continue; }
      if (new Date(m.lastCheckedAt.getTime() + m.intervalMins * 60_000) <= now) due.add(m.url);
    }

    for (const url of due) {
      await checkQueue.add("check", { url }, {
        jobId: url, attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: true,
      });
    }
    if (due.size) console.log(`⏱ Scheduled ${due.size} URLs`);
  } catch (err) { console.error("Scheduler:", err); }
});

console.log("⏰ Scheduler started");