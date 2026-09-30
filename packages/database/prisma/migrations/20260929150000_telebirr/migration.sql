-- Telebirr: a money balance the Owner loads. Salespeople spend it two ways,
-- both taken off the balance: CASH_IN (a customer hands over cash and gets
-- Telebirr money) and AIRTIME (airtime sold from Telebirr).
--
-- Hand-written like every migration here: guards exist on this database that
-- do not appear in schema.prisma.

CREATE TABLE "TelebirrLoad" (
    "id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelebirrLoad_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TelebirrLoad_amount_positive" CHECK ("amount" > 0)
);

CREATE TABLE "TelebirrTransaction" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "locationId" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "customerPhone" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelebirrTransaction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TelebirrTransaction_kind_check" CHECK ("kind" IN ('CASH_IN', 'AIRTIME')),
    CONSTRAINT "TelebirrTransaction_amount_positive" CHECK ("amount" > 0)
);

CREATE INDEX "TelebirrLoad_createdAt_idx" ON "TelebirrLoad"("createdAt");
CREATE INDEX "TelebirrTransaction_createdAt_idx" ON "TelebirrTransaction"("createdAt");
CREATE INDEX "TelebirrTransaction_locationId_idx" ON "TelebirrTransaction"("locationId");
CREATE INDEX "TelebirrTransaction_recordedById_idx" ON "TelebirrTransaction"("recordedById");

ALTER TABLE "TelebirrLoad" ADD CONSTRAINT "TelebirrLoad_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TelebirrTransaction" ADD CONSTRAINT "TelebirrTransaction_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TelebirrTransaction" ADD CONSTRAINT "TelebirrTransaction_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
