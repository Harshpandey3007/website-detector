import crypto from "crypto";
import { Router } from "express";

/**
 * A page YOU control, hosted by your own API, so a live demo never depends on a
 * third-party site changing on cue.
 *
 *   GET  /demo/store     the page your monitor watches
 *   GET  /demo/control   a remote with big buttons (open it as /demo/control?key=DEMO_KEY)
 *   POST /demo/control   { action } with header x-demo-key
 *
 * Mounted only when DEMO_KEY is set (see index.ts). The monitor must point at a PUBLIC
 * URL (your Render URL, or an ngrok URL): the SSRF guard blocks localhost on purpose.
 */
const state = { sale: false, soldOut: false };

const safeEqual = (a: string, b: string) => {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
};

function storePage() {
  const price = state.sale ? "$29" : "$49";
  const banner = state.sale
    ? `<div class="banner">⚡ FLASH SALE · 40% OFF · TODAY ONLY</div>` : "";
  const was = state.sale ? `<span class="was">$49</span>` : "";
  const badge = state.soldOut
    ? `<span class="badge out">SOLD OUT</span>`
    : `<span class="badge ok">${state.sale ? "Only 7 seats left at this price" : "In stock"}</span>`;
  const cta = state.soldOut ? "Join the waitlist" : "Start free trial";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Aegis Pro · Pricing</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:system-ui,Segoe UI,Arial,sans-serif;color:#e4e4e7;
background:radial-gradient(900px 500px at 50% -10%,#3730a3 0%,#09090b 60%)}
.banner{background:linear-gradient(90deg,#dc2626,#f97316);color:#fff;text-align:center;font-weight:800;padding:16px;letter-spacing:.05em}
main{max-width:520px;margin:64px auto;padding:0 20px}
.card{background:#18181b;border:1px solid #3f3f46;border-radius:20px;padding:36px;box-shadow:0 30px 80px rgba(0,0,0,.5)}
h1{margin:0 0 6px;font-size:28px}p{color:#a1a1aa;margin:0 0 24px}
.price{font-size:64px;font-weight:800;color:#fff}.was{font-size:28px;color:#71717a;text-decoration:line-through;margin-left:12px}
.badge{display:inline-block;margin:12px 0 24px;padding:6px 12px;border-radius:999px;font-size:13px;font-weight:600}
.ok{background:#064e3b;color:#6ee7b7}.out{background:#450a0a;color:#fca5a5}
ul{padding-left:18px;color:#d4d4d8;line-height:1.9}
.cta{display:block;margin-top:24px;text-align:center;background:#6366f1;color:#fff;padding:14px;border-radius:12px;font-weight:700}
</style></head><body>${banner}<main><div class="card">
<h1>Aegis Pro · Team plan</h1><p>Website monitoring for teams that ship.</p>
<div><span class="price">${price}</span>${was}<span style="color:#71717a"> / month</span></div>${badge}
<ul><li>Unlimited monitors</li><li>AI change summaries</li><li>Visual diff history</li></ul>
<span class="cta">${cta}</span></div></main></body></html>`;
}

const controlPage = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Demo remote</title><style>
body{margin:0;padding:24px;font-family:system-ui,Arial,sans-serif;background:#09090b;color:#e4e4e7}
h1{font-size:18px}button{display:block;width:100%;margin:10px 0;padding:18px;font-size:17px;font-weight:700;border:0;border-radius:12px;color:#fff;cursor:pointer}
#on{background:#dc2626}#off{background:#52525b}#out{background:#b45309}#reset{background:#3f3f46}pre{color:#a1a1aa}
</style></head><body><h1>Demo remote</h1>
<button id="on">⚡ Start flash sale ($49 → $29)</button><button id="off">↩ End sale</button>
<button id="out">🚫 Mark sold out</button><button id="reset">Reset page</button><pre id="log">ready</pre>
<script>
const key=new URLSearchParams(location.search).get("key")||"";
const send=async a=>{const r=await fetch("/demo/control",{method:"POST",headers:{"Content-Type":"application/json","x-demo-key":key},body:JSON.stringify({action:a})});
document.getElementById("log").textContent=r.ok?a+" → "+new Date().toLocaleTimeString():"Rejected ("+r.status+"): check ?key=";};
document.getElementById("on").onclick=()=>send("sale_on");document.getElementById("off").onclick=()=>send("sale_off");
document.getElementById("out").onclick=()=>send("sold_out");document.getElementById("reset").onclick=()=>send("reset");
</script></body></html>`;

export const demoRouter = Router();

demoRouter.get("/store", (_req, res) => {
  res.set("Cache-Control", "no-store").type("html").send(storePage());
});

demoRouter.get("/control", (_req, res) => {
  res.set("Cache-Control", "no-store").type("html").send(controlPage);
});

demoRouter.post("/control", (req, res) => {
  const key = String(req.header("x-demo-key") ?? "");
  if (!process.env.DEMO_KEY || !safeEqual(key, process.env.DEMO_KEY)) return res.status(401).json({ error: "Unauthorized" });
  switch (req.body?.action) {
    case "sale_on": state.sale = true; state.soldOut = false; break;
    case "sale_off": state.sale = false; break;
    case "sold_out": state.soldOut = true; break;
    case "reset": state.sale = false; state.soldOut = false; break;
    default: return res.status(400).json({ error: "Unknown action" });
  }
  res.json(state);
});
