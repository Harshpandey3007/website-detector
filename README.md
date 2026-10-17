# 🌐 Aegis Watch — Website Change Detector

**Live Demo (Frontend):** [website-detector-amq4.vercel.app]
**Backend API:** [https://website-detector-151j.onrender.com]
**Swagger API Docs:** https://website-detector-151j.onrender.com/docs
**Prometheus Metrics:** https://website-detector-151j.onrender.com/metrics
**Frontend Source Code:** https://github.com/Harshpandey3007/website-detector-frontend

A production-grade, full-stack application that monitors public web pages and alerts users to **meaningful changes** while intelligently ignoring noise. 


---

## ✨ Key Features

- 🎭 **Headless Browser Rendering:** Uses Playwright + Stealth to accurately capture JavaScript-heavy pages.
- 🧠 **AI Change Summaries:** Integrates Google Gemini 1.5 Flash to generate human-readable, one-sentence summaries of what actually changed.
- 🔇 **Noise Filtering:** Strips timestamps, counters, and random tokens before hashing to prevent false alarms.
- 📸 **Visual & Text Diffing:** Side-by-side pixel comparison (via `pixelmatch`) alongside text diffs.
- ⚡ **URL Deduplication:** If 200 users monitor the same URL, it is fetched only once via BullMQ job deduplication.
- 🚦 **Rate Limiting & Jitter:** Prevents hammering target sites.
- 🔒 **Security Hardened:** SSRF protection (blocks internal IPs), SHA-256 hashed API keys, IDOR protection.
- 📊 **Observability:** Prometheus metrics and interactive Swagger API documentation.

---

## 🏗️ Architecture

```mermaid
graph LR
    A[Next.js Frontend] -->|REST + API Key| B[Express API]
    B -->|enqueue| C[(Redis + BullMQ)]
    C -->|jobs| D[Playwright Worker]
    D -->|fetch| E[Target Websites]
    D -->|diff + AI| F[(SQLite + Prisma)]
    D -->|alert| G[Discord Webhook]
🧪 Test Script (Backend)
To verify the backend implementation and security (as required by the hackathon), run the integration test suite:

bash
# Terminal 1: Start the backend server
cd backend
npm run dev

# Terminal 2: Run the test script
node test.js
Expected Output: 📊 8 passed, 0 failed
(Tests include: Auth blocking, SSRF protection, CRUD operations, and queue triggering).

🛠️ Tech Stack
Frontend:

Next.js 14 (App Router)

TypeScript & Tailwind CSS

Lucide React (Icons) & React Hot Toast

Backend:

Node.js 20 & Express

Prisma ORM + SQLite

BullMQ + Redis (Upstash)

Playwright + playwright-extra

Google Gemini API

🚀 Local Setup
1. Backend Setup
bash
git clone [Insert Backend Repo URL]
cd backend
npm install
npx playwright install chromium
npx prisma migrate dev --name init
Create a .env file:

env
PORT=3000
DATABASE_URL="file:./dev.db"
REDIS_URL=rediss://default:YOUR_PASSWORD@your-db.upstash.io:6379
API_KEY=your-super-secure-api-key-min-16-chars
GEMINI_API_KEY=your-gemini-api-key
DISCORD_WEBHOOK_URL=your-discord-webhook
Start the backend: npm run dev

2. Frontend Setup
bash
git clone [https://github.com/Harshpandey3007/website-detector]
cd frontend
npm install
Create a .env.local file:

env
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_API_KEY=your-super-secure-api-key-min-16-chars
Start the frontend: npm run dev

🔒 Security Design Decisions
SSRF Protection: Uses net.BlockList to resolve DNS and block private IP ranges (10.x, 192.168.x, etc.), preventing the scraper from hitting internal infrastructure.

API Key Auth: Keys are hashed with SHA-256 before being stored in the database. Keys are validated using an indexed lookup to prevent timing attacks.

Data Isolation: Monitors are scoped to the ownerId (API Key ID) that created them, preventing Insecure Direct Object Reference (IDOR) vulnerabilities.

📄 License
MIT