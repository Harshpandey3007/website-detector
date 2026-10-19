import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import * as cheerio from "cheerio";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { stripNoise } from "./noise";
import { isSafeUrl, isSafeUrlCached } from "./ssrf";
import { PUBLIC_DIR } from "./paths";

chromium.use(stealth());
const SCREENSHOT_DIR = path.join(PUBLIC_DIR, "screenshots");

export interface ScrapeResult {
  ok: boolean;
  status: "OK" | "ERROR" | "BLOCKED";
  reason?: string;
  html?: string;
  screenshotPath?: string;
}

export async function fetchPage(url: string): Promise<ScrapeResult> {
  // Re-validate at fetch time: the URL was only checked when the monitor was
  // created, and DNS can change after that.
  const pre = await isSafeUrl(url);
  if (!pre.ok) return { ok: false, status: "ERROR", reason: `Blocked by SSRF policy: ${pre.reason}` };

  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
 const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage", // CRITICAL for Render/Docker
    "--disable-gpu",
    "--single-process",        // Runs Chromium in one process to save RAM
    "--no-zygote"              // Further reduces memory
  ],
});
  try {
    const ctx = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
      viewport: { width: 1440, height: 900 },
      serviceWorkers: "block", // a service worker could fetch around the route guard below
      deviceScaleFactor: 2
    });
    await ctx.route("**/*.{png,jpg,jpeg,webp,svg,gif,woff,woff2}", route => route.abort());
    // Every request the page makes (the navigation, each redirect hop, iframes,
    // XHR/fetch, images) goes through this guard, not just the first URL.
    await ctx.route("**/*", async (route) => {
      try {
        const reqUrl = route.request().url();
        if (/^(data|blob|about):/i.test(reqUrl)) return await route.continue();
        const verdict = await isSafeUrlCached(reqUrl);
        if (verdict.ok) return await route.continue();
        console.warn("SSRF guard blocked", reqUrl, "-", verdict.reason);
      } catch { /* fall through to abort */ }
      await route.abort("blockedbyclient").catch(() => {});
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
    const fname = `${Date.now()}-${crypto.randomBytes(16).toString("hex")}.png`;
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
