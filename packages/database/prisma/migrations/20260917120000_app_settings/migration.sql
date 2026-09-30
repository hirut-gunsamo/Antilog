-- Organisation-wide settings.
--
-- Additive only. No existing table is altered and no row is deleted.
--
-- The table is a singleton: one row, id = 'app'. A CHECK constraint enforces
-- that rather than convention, so a second row cannot be inserted by mistake
-- from a script or a console. Prisma cannot express a CHECK, so it lives here
-- and will not appear in schema.prisma.

CREATE TABLE "AppSetting" (
  "id" TEXT NOT NULL DEFAULT 'app',

  "systemName" TEXT NOT NULL DEFAULT 'SIM Card and Phone Management System',
  "defaultLanguage" TEXT NOT NULL DEFAULT 'en',
  "currency" TEXT NOT NULL DEFAULT 'ETB',
  "dateFormat" TEXT NOT NULL DEFAULT 'medium',
  "timeFormat" TEXT NOT NULL DEFAULT '24h',
  "itemsPerPage" INTEGER NOT NULL DEFAULT 10,

  "notifySales" BOOLEAN NOT NULL DEFAULT true,
  "notifyRequests" BOOLEAN NOT NULL DEFAULT true,
  "notifyApprovals" BOOLEAN NOT NULL DEFAULT true,
  "notifyLowStock" BOOLEAN NOT NULL DEFAULT true,
  "notifySystem" BOOLEAN NOT NULL DEFAULT false,

  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedById" TEXT,

  CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

-- One row, always. This is the whole reason the table can be read without a
-- lookup key anywhere in the app.
ALTER TABLE "AppSetting"
  ADD CONSTRAINT "AppSetting_singleton" CHECK ("id" = 'app');

-- Settings must survive the person who changed them leaving.
ALTER TABLE "AppSetting"
  ADD CONSTRAINT "AppSetting_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the single row so every read finds one and no caller has to create it.
INSERT INTO "AppSetting" ("id", "updatedAt") VALUES ('app', NOW());
