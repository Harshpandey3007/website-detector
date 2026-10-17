# 🌐 Aegis Watch — Website Change Detector (Backend)

![Node.js](https://img.shields.io/badge/Node.js-20-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)
![Prisma](https://img.shields.io/badge/Prisma-5.22-1B222D)
![BullMQ](https://img.shields.io/badge/BullMQ-5.34-red)
![Playwright](https://img.shields.io/badge/Playwright-1.47-green)



**Frontend Source Code:** [https://github.com/Harshpandey3007/website-detector-frontend](https://github.com/Harshpandey3007/website-detector-frontend)
**Backend API URL:** https://website-detector-151j.onrender.com
**Swagger API Docs:** https://website-detector-151j.onrender.com/docs
**Prometheus Metrics:** https://website-detector-151j.onrender.com/metrics


A production-grade backend service that monitors public web pages and alerts users to **meaningful changes** while intelligently ignoring noise. 

## 🏗️ Architecture

```mermaid
graph LR
    Client[Next.js Frontend] -->|REST + API Key| API[Express API]
    
    API -->|Enqueue Jobs| Queue[(Redis + BullMQ)]
    API -->|Read/Write| DB[(SQLite + Prisma)]
    
    Queue -->|Process| Worker[Playwright Worker]
    
    Worker -->|Fetch| Web[Target Websites]
    Worker -->|Hash & Diff| Engine[Diff & Noise Engine]
    Worker -->|AI Summary| Gemini[Google Gemini AI]
    
    Engine -->|Save Snapshot| DB
    Engine -->|Trigger Alert| Alerts["Discord / Email"]
✨ Key Features
🎭 Headless Browser Rendering: Uses Playwright + Stealth to accurately capture JavaScript-heavy pages.

🧠 AI Change Summaries: Integrates Google Gemini 1.5 Flash to generate human-readable summaries of what actually changed.

🔇 Noise Filtering: Strips timestamps, counters, and random tokens before hashing to prevent false alarms.

📸 Visual & Text Diffing: Side-by-side pixel comparison alongside text diffs.

⚡ URL Deduplication: If 200 users monitor the same URL, it is fetched only once via BullMQ job deduplication.

🚦 Rate Limiting & Jitter: Prevents hammering target sites.

🔒 Security Hardened: SSRF protection (blocks internal IPs), SHA-256 hashed API keys, IDOR protection.

🧪 Test Script
To verify the backend implementation and security, run the integration test suite:

bash
# Terminal 1: Start the backend server
npm run dev

# Terminal 2: Run the test script
node test.js
Expected Output: 📊 8 passed, 0 failed
(Tests include: Auth blocking, SSRF protection, CRUD operations, and queue triggering).

🛠️ Local Setup
npm install & npx playwright install chromium

Configure .env (PORT, DATABASE_URL, REDIS_URL, API_KEY, GEMINI_API_KEY)

npx prisma migrate dev --name init

npm run dev

🔒 Security Design Decisions
SSRF Protection: Uses net.BlockList to resolve DNS and block private IP ranges.

API Key Auth: Keys are hashed with SHA-256 before being stored in the database.

Data Isolation: Monitors are scoped to the API Key that created them.

📄 License
MIT


