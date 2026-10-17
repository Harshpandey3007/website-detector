-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Alert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "monitorId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'change',
    "dedupeKey" TEXT,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Alert_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Alert" ("id", "monitorId", "sentAt", "summary") SELECT "id", "monitorId", "sentAt", "summary" FROM "Alert";
DROP TABLE "Alert";
ALTER TABLE "new_Alert" RENAME TO "Alert";
CREATE INDEX "Alert_monitorId_sentAt_idx" ON "Alert"("monitorId", "sentAt");
CREATE UNIQUE INDEX "Alert_monitorId_dedupeKey_key" ON "Alert"("monitorId", "dedupeKey");
CREATE TABLE "new_Monitor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intervalMins" INTEGER NOT NULL,
    "sensitivity" INTEGER NOT NULL DEFAULT 5,
    "ignoreSelectors" TEXT,
    "watchSelectors" TEXT,
    "lastCheckedAt" DATETIME,
    "lastChangedAt" DATETIME,
    "nextCheckAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "ownerId" TEXT,
    CONSTRAINT "Monitor_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "ApiKey" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Monitor" ("id", "ignoreSelectors", "intervalMins", "lastChangedAt", "lastCheckedAt", "name", "sensitivity", "status", "url", "watchSelectors") SELECT "id", "ignoreSelectors", "intervalMins", "lastChangedAt", "lastCheckedAt", "name", "sensitivity", "status", "url", "watchSelectors" FROM "Monitor";
DROP TABLE "Monitor";
ALTER TABLE "new_Monitor" RENAME TO "Monitor";
CREATE INDEX "Monitor_nextCheckAt_idx" ON "Monitor"("nextCheckAt");
CREATE INDEX "Monitor_ownerId_idx" ON "Monitor"("ownerId");
CREATE INDEX "Monitor_url_idx" ON "Monitor"("url");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "Snapshot_monitorId_createdAt_idx" ON "Snapshot"("monitorId", "createdAt");
