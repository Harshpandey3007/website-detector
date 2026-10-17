import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient();

// SQLite tuning. WAL lets readers run while the single writer writes, and
// busy_timeout makes a blocked writer wait instead of throwing SQLITE_BUSY.
// Both PRAGMAs are per-connection, so DATABASE_URL must include
// ?connection_limit=1 for them to apply to every query.
void (async () => {
  try {
    await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL");
    await prisma.$queryRawUnsafe("PRAGMA busy_timeout = 5000");
    await prisma.$queryRawUnsafe("PRAGMA synchronous = NORMAL");
  } catch (err) {
    console.error("SQLite PRAGMA setup failed:", err);
  }
})();
