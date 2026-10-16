import { Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";

export const connection = new IORedis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: null,
});

export const CHECK_QUEUE = "check-queue";
export const checkQueue = new Queue(CHECK_QUEUE, { connection });
export const queueEvents = new QueueEvents(CHECK_QUEUE, { connection });