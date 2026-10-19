import axios from "axios";
import FormData from "form-data";
import fs from "fs/promises";
import nodemailer, { type SendMailOptions, type Transporter } from "nodemailer";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";

const BRAND = "Aegis Watch";

export type Channel = "discord" | "telegram" | "email";
export interface ChannelResult { channel: Channel; status: "sent" | "skipped" | "failed"; error?: string }

export interface ChangeAlert {
  monitorId: string;
  monitorName: string;
  url: string;
  summary: string;
  changePercent: number;
  snapshotId: string;
  prevSnapshotId: string;
  /** Absolute path of the pixel-diff PNG on disk (attached/uploaded, so no public URL is needed). */
  diffImageAbsPath?: string | null;
}

export interface StatusAlert { monitorName: string; url: string; status: string; reason?: string }

// ───────────────────────── helpers ─────────────────────────

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
const frontendUrl = () => (process.env.FRONTEND_URL || "http://localhost:3001").replace(/\/+$/, "");

/** Deep link into the visual diff viewer, pre-loaded with the two snapshots that differ. */
export const viewerLink = (c: Pick<ChangeAlert, "monitorId" | "prevSnapshotId" | "snapshotId">) =>
  `${frontendUrl()}/monitors/${c.monitorId}?compare=${c.prevSnapshotId}:${c.snapshotId}`;

/** Telegram rejects localhost / private hosts in buttons, so only offer a button for real public URLs. */
function isPublicHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    const h = u.hostname;
    return /^https?:$/.test(u.protocol) && h.includes(".") &&
      !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) && !/\.(local|localhost|internal|lan)$/.test(h);
  } catch { return false; }
}

async function attempt(channel: Channel, configured: boolean, fn: () => Promise<void>): Promise<ChannelResult> {
  if (!configured) return { channel, status: "skipped" };
  try {
    await fn();
    return { channel, status: "sent" };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`${channel} alert failed:`, error);
    return { channel, status: "failed", error };
  }
}

// ───────────────────────── Discord ─────────────────────────

export const discordConfigured = () => !!process.env.DISCORD_WEBHOOK_URL;

async function postDiscord(content: string) {
  await axios.post(
    process.env.DISCORD_WEBHOOK_URL!,
    // monitor.name is user input: never let it ping @everyone / roles
    { content: content.slice(0, 1900), allowed_mentions: { parse: [] } },
    { timeout: 5_000 }, // a hung webhook must not hold a worker slot forever
  );
}

// ───────────────────────── Telegram ─────────────────────────

const telegramConfig = () => {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  return token && chatId ? { token, chatId } : null;
};
export const telegramConfigured = () => !!telegramConfig();

async function telegramCall(token: string, method: string, payload: object | FormData) {
  const isForm = payload instanceof FormData;
  const res = await axios.post(`https://api.telegram.org/bot${token}/${method}`, payload, {
    timeout: 15_000,
    headers: isForm ? payload.getHeaders() : undefined,
    maxBodyLength: Infinity,
    validateStatus: () => true, // read Telegram's own error text instead of a generic axios one
  });
  if (!res.data?.ok) throw new Error(res.data?.description || `HTTP ${res.status}`);
}

/** Sends HTML text, optionally as a photo caption (the diff image) with an "Open" button. */
async function sendTelegram(html: string, opts: { photoPath?: string | null; buttonUrl?: string; buttonText?: string } = {}) {
  const cfg = telegramConfig()!;
  const markup = opts.buttonUrl && isPublicHttpUrl(opts.buttonUrl)
    ? { inline_keyboard: [[{ text: opts.buttonText || "🔍 Open visual diff", url: opts.buttonUrl }]] }
    : undefined;

  if (opts.photoPath) {
    try {
      const form = new FormData();
      form.append("chat_id", cfg.chatId);
      form.append("caption", html);
      form.append("parse_mode", "HTML");
      if (markup) form.append("reply_markup", JSON.stringify(markup));
      form.append("photo", await fs.readFile(opts.photoPath), { filename: "visual-diff.png", contentType: "image/png" });
      await telegramCall(cfg.token, "sendPhoto", form);
      return;
    } catch (err) {
      console.warn("Telegram photo failed, falling back to text:", err instanceof Error ? err.message : err);
    }
  }
  await telegramCall(cfg.token, "sendMessage", {
    chat_id: cfg.chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: markup,
  });
}

const tgLink = (url: string, label: string) =>
  isPublicHttpUrl(url) ? `<a href="${esc(url)}">${esc(label)}</a>` : `<code>${esc(label)}</code>`;

function telegramChangeText(c: ChangeAlert) {
  return [
    `🔔 <b>${BRAND}</b> · Change detected`,
    "",
    `<b>${esc(clip(oneLine(c.monitorName), 100))}</b>`,
    tgLink(c.url, clip(c.url, 120)),
    "",
    `🧠 <i>${esc(clip(oneLine(c.summary), 400))}</i>`,
    `📊 ${c.changePercent.toFixed(1)}% of the page text changed`,
    "",
    `🔍 Visual diff: ${tgLink(viewerLink(c), "open in dashboard")}`,
  ].join("\n");
}



const emailTo = () => (process.env.EMAIL_TO || "").split(",").map((s) => s.trim()).filter(Boolean);
export const emailConfigured = () => !!process.env.SMTP_HOST && emailTo().length > 0;

let transporter: Transporter | undefined;
function getTransporter(): Transporter {
  if (transporter) return transporter;
  const port = Number(process.env.SMTP_PORT) || 587;
  const { SMTP_USER: user, SMTP_PASS: pass } = process.env;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return transporter;
}

function emailShell(title: string, bodyHtml: string) {
  return `<!doctype html><html><body style="margin:0;background:#09090b;padding:24px;font-family:Inter,Segoe UI,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#18181b;border:1px solid #27272a;border-radius:14px;overflow:hidden;">
<tr><td style="padding:18px 24px;border-bottom:1px solid #27272a;color:#a1a1aa;font-size:13px;">
<span style="color:#818cf8;font-weight:700;">&#9679;</span>&nbsp; ${BRAND} &nbsp;·&nbsp; ${esc(title)}</td></tr>
<tr><td style="padding:24px;color:#e4e4e7;font-size:15px;line-height:1.55;">${bodyHtml}</td></tr>
</table>
<p style="color:#52525b;font-size:12px;margin-top:16px;">Sent by ${BRAND}. You receive this because EMAIL_TO is configured on the server.</p>
</td></tr></table></body></html>`;
}

const button = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px;">${esc(label)}</a>`;

async function sendEmail(subject: string, html: string, text: string, attachments: SendMailOptions["attachments"] = []) {
  await getTransporter().sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_USER || `${BRAND} <no-reply@localhost>`,
    to: emailTo(),
    subject: clip(oneLine(subject), 150),
    html,
    text,
    attachments,
  });
}

function emailChange(c: ChangeAlert) {
  const link = viewerLink(c);
  const hasImg = !!c.diffImageAbsPath;
  const html = emailShell("Change detected", `
    <h2 style="margin:0 0 4px;font-size:20px;color:#fff;">${esc(c.monitorName)}</h2>
    <a href="${esc(c.url)}" style="color:#818cf8;font-size:14px;word-break:break-all;">${esc(c.url)}</a>
    <div style="margin:20px 0;padding:14px 16px;background:#09090b;border:1px solid #27272a;border-radius:10px;">
      <div style="color:#a1a1aa;font-size:12px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">AI summary</div>
      <div style="color:#f4f4f5;">${esc(c.summary)}</div>
      <div style="color:#71717a;font-size:13px;margin-top:8px;">${c.changePercent.toFixed(1)}% of the page text changed</div>
    </div>
    ${hasImg ? `<img src="cid:visual-diff" alt="Visual diff" width="552" style="width:100%;border-radius:10px;border:1px solid #27272a;margin-bottom:20px;">` : ""}
    ${button(link, "Open visual diff")}`);
  const text = `${BRAND}: ${c.monitorName} changed\n${c.url}\n\nSummary: ${c.summary}\n${c.changePercent.toFixed(1)}% of the page text changed\n\nVisual diff: ${link}`;
  const attachments = hasImg ? [{ filename: "visual-diff.png", path: c.diffImageAbsPath!, cid: "visual-diff" }] : [];
  return sendEmail(`🔔 ${c.monitorName} changed`, html, text, attachments);
}

// ───────────────────────── public API ─────────────────────────

export const getChannelStatus = () => ({
  discord: discordConfigured(),
  telegram: telegramConfigured(),
  email: emailConfigured(),
});

/** Fans a change alert out to every configured channel in parallel. Never throws. */
export async function notifyChange(c: ChangeAlert): Promise<ChannelResult[]> {
  const link = viewerLink(c);
  return Promise.all([
    attempt("discord", discordConfigured(), () =>
      postDiscord(`🔔 **${c.monitorName}** changed\n${c.summary}\n${c.url}\n🔍 <${link}>`)),
    attempt("telegram", telegramConfigured(), () =>
      sendTelegram(telegramChangeText(c), { photoPath: c.diffImageAbsPath, buttonUrl: link })),
    attempt("email", emailConfigured(), () => emailChange(c)),
  ]);
}

export async function notifyStatus(s: StatusAlert): Promise<ChannelResult[]> {
  const line = `${s.monitorName} → ${s.status}${s.reason ? ` (${s.reason})` : ""}`;
  return Promise.all([
    attempt("discord", discordConfigured(), () => postDiscord(`⚠️ **${s.monitorName}** → ${s.status}\n${s.url}`)),
    attempt("telegram", telegramConfigured(), () =>
      sendTelegram(`⚠️ <b>${BRAND}</b> · Monitor problem\n\n<b>${esc(clip(oneLine(s.monitorName), 100))}</b> is now <b>${esc(s.status)}</b>\n${esc(s.reason || "")}\n${esc(clip(s.url, 120))}`)),
    attempt("email", emailConfigured(), () =>
      sendEmail(`⚠️ ${line}`, emailShell("Monitor problem",
        `<h2 style="margin:0 0 8px;color:#fff;">${esc(s.monitorName)} is ${esc(s.status)}</h2><p style="color:#a1a1aa;">${esc(s.reason || "")}</p><a href="${esc(s.url)}" style="color:#818cf8;">${esc(s.url)}</a>`), `${line}\n${s.url}`)),
  ]);
}

/** "Send test alert" button + the first thing to run before a live demo. */
export async function sendTestAlert(): Promise<ChannelResult[]> {
  const link = frontendUrl();
  return Promise.all([
    attempt("discord", discordConfigured(), () => postDiscord(`✅ ${BRAND} test alert: Discord is connected.`)),
    attempt("telegram", telegramConfigured(), () =>
      sendTelegram(`✅ <b>${BRAND}</b> test alert\nTelegram is connected and ready.`, { buttonUrl: link, buttonText: "Open dashboard" })),
    attempt("email", emailConfigured(), () =>
      sendEmail(`✅ ${BRAND} test alert`, emailShell("Test alert",
        `<h2 style="margin:0 0 12px;color:#fff;">Email is connected</h2><p style="color:#a1a1aa;">Change alerts will arrive in this inbox.</p>${button(link, "Open dashboard")}`),
        `${BRAND} test alert: email is connected.`)),
  ]);
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
