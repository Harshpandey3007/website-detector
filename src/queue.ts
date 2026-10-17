import { Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { createHash } from "crypto";

export const connection = new IORedis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: null,
});

export const CHECK_QUEUE = "check-queue";
export const checkQueue = new Queue(CHECK_QUEUE, { connection });
export const queueEvents = new QueueEvents(CHECK_QUEUE, { connection });

// BullMQ silently ignores add() when a job with the same id still exists in ANY
// state (waiting, active, delayed, completed, failed). So:
//  - the id must be deterministic, which is what dedupes "200 users, 1 URL";
//  - finished jobs must delete themselves, or that URL can never be queued again;
//  - the id can't be the raw URL, because BullMQ rejects ":" in custom ids.
export const checkJobId = (url: string) =>
  "check-" + createHash("sha1").update(url).digest("hex");

export function enqueueCheck(url: string) {
  return checkQueue.add("check", { url }, {
    jobId: checkJobId(url),
    attempts: 3,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: true,
    removeOnFail: true,
  });
}
const logErr = (name: string) => (err: Error) => console.error(`[${name}]`, err.message);
connection.on("error", logErr("redis"));
checkQueue.on("error", logErr("queue"));
