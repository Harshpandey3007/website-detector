import axios from "axios";
import { prisma } from "./db";

export async function sendDiscord(content: string) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return;
  try { await axios.post(webhook, { content }); }
  catch (err) { console.error("Discord failed:", err); }
}

export async function shouldSendAlert(monitorId: string, windowMinutes = 30): Promise<boolean> {
  const since = new Date(Date.now() - windowMinutes * 60_000);
  const recent = await prisma.alert.findFirst({ where: { monitorId, sentAt: { gte: since } } });
  return !recent;
}

export async function recordAlert(monitorId: string, summary: string) {
  await prisma.alert.create({ data: { monitorId, summary } });
}