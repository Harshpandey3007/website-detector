import axios from "axios";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";

export async function sendDiscord(content: string) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return;
  try {
    await axios.post(
      webhook,
      // monitor.name is user input: never let it ping @everyone / roles
      { content: content.slice(0, 1900), allowed_mentions: { parse: [] } },
      { timeout: 5_000 }, // a hung webhook must not hold a worker slot forever
    );
  } catch (err) { console.error("Discord failed:", (err as Error).message); }
}

/**
 * Atomically claims the right to send an alert. The unique (monitorId, dedupeKey)
 * index turns "check, then insert" into one operation, so two workers or a job
 * retry can't both win. One alert per kind per monitor per fixed time window.
 * Returns true if the caller should send.
 */
export async function claimAlert(
  monitorId: string,
  kind: "change" | "status",
  summary: string,
  windowMinutes: number,
): Promise<boolean> {
  const bucket = Math.floor(Date.now() / (windowMinutes * 60_000));
  try {
    await prisma.alert.create({ data: { monitorId, kind, summary, dedupeKey: `${kind}:${bucket}` } });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
    throw err;
  }
}
