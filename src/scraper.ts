import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import * as cheerio from "cheerio";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { stripNoise } from "./noise";

chromium.use(stealth());
const SCREENSHOT_DIR = path.join(process.cwd(), "public", "screenshots");

export interface ScrapeResult {
  ok: boolean;
  status: "OK" | "ERROR" | "BLOCKED";
  reason?: string;
  html?: string;
  screenshotPath?: string;
}

export async function fetchPage(url: string): Promise<ScrapeResult> {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
      viewport: { width: 1440, height: 900 },
    });
    const page = await ctx.newPage();
    const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    const status = resp?.status() ?? 0;
    const title = (await page.title()).toLowerCase();
    const body = await page.evaluate(() => document.body?.innerText || "");

    const blocked = status === 403 || status === 429 ||
      title.includes("captcha") || title.includes("just a moment") ||
      body.toLowerCase().includes("checking your browser");

    if (blocked) return { ok: false, status: "BLOCKED", reason: `HTTP ${status}` };
    if (status >= 400) return { ok: false, status: "ERROR", reason: `HTTP ${status}` };

    const html = await page.content();
    const fname = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.png`;
    const screenshotPath = path.join(SCREENSHOT_DIR, fname);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await ctx.close();
    return { ok: true, status: "OK", html, screenshotPath };
  } catch (err: any) {
    return { ok: false, status: "ERROR", reason: err?.message || "Unknown" };
  } finally {
    await browser.close();
  }
}

export function extractText(html: string, ignore?: string | null, watch?: string | null): string {
  const $ = cheerio.load(html);
  if (ignore) ignore.split(",").map(s => s.trim()).filter(Boolean).forEach(s => { try { $(s).remove(); } catch {} });

  let raw = "";
  if (watch) {
    const parts: string[] = [];
    watch.split(",").map(s => s.trim()).filter(Boolean).forEach(s => {
     try { $(s).each((_, el) => { parts.push($(el).text()); }); } catch {}
    });
    raw = parts.join("\n");
  } else raw = $("body").text();
  return stripNoise(raw);
}

export function hashText(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}