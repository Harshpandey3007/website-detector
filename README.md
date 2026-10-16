# 🌐 Website Change Detector

A backend service that monitors public web pages and alerts users to meaningful changes while ignoring noise.

## Features

- Headless browser rendering (Playwright + stealth)
- Configurable intervals (15 min - 24 hours)
- Noise filtering (timestamps, counters, random tokens)
- CSS selector watch/ignore support
- Text + visual diffing (pixelmatch)
- Discord alerts with deduplication
- URL deduplication (200 users on 1 URL -> 1 fetch)
- Rate limiting
- SSRF protection (blocks localhost, private IPs)
- Retries with exponential backoff (BullMQ)
- Status tracking (OK / ERROR / BLOCKED - CAPTCHA handled)

## Tech Stack

- Node.js 20 + TypeScript
- Express 4
- SQLite + Prisma 5
- BullMQ + Redis (Upstash)
- Playwright + Stealth plugin
- diff (text) + pixelmatch (visual)

## Setup

### Prerequisites
- Node.js v20.x
- Redis (Upstash free tier)

### Install
    npm install
    npx playwright install chromium

### Configure .env
    PORT=3000
    REDIS_URL=rediss://default:PASSWORD@your-db.upstash.io:6379
    DATABASE_URL="file:./dev.db"
    API_KEY=secret-demo-key
    DISCORD_WEBHOOK_URL=

### Migrate DB
    npx prisma migrate dev --name init

### Run
    npm run dev

### Test
    node test.js

## API Endpoints

All require x-api-key: secret-demo-key header (except /health).

| Method | Endpoint | Purpose |
|---|---|---|
| GET | /health | Health check |
| POST | /monitors | Create monitor |
| GET | /monitors | List monitors |
| GET | /monitors/:id | Get monitor |
| DELETE | /monitors/:id | Delete monitor |
| POST | /monitors/:id/check | Manual check |
| GET | /monitors/:id/history | Snapshot timeline |
| GET | /monitors/:id/compare/:v1/:v2 | Side-by-side diff |
| GET | /alerts | Recent alerts |

### Example: Create Monitor

    curl -X POST http://localhost:3000/monitors \
      -H "Content-Type: application/json" \
      -H "x-api-key: secret-demo-key" \
      -d '{"url":"https://example.com","name":"Example","intervalMins":15,"sensitivity":5}'

## How It Works

1. Scheduler runs every minute, finds due monitors, queues jobs (one per URL - deduplication)
2. Worker picks up jobs, renders pages with Playwright, extracts text, hashes
3. Noise Filter strips timestamps/counters/tokens before hashing
4. Diff Engine compares old vs new text + screenshots if hash changed
5. Alerts sent via Discord, deduplicated within 30-min window
6. Status = BLOCKED on CAPTCHA, ERROR on failure (no false alerts)

## Security

- SSRF protection blocks localhost, private IPs, AWS metadata
- Only http/https protocols allowed
- API key required
- No credential storage - public pages only

## Test Script

Run the server in one terminal:

    npm run dev

Run the test script in another:

    node test.js

Expected: 8 passed, 0 failed

## License

MIT
