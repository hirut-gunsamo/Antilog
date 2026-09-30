-- Blank ID card stock, per branch.
--
-- A log of arrivals only. What is left is derived as (received - printed), so
-- there is no balance column that can fall out of step with the print records.
--
-- Hand-written like every migration here: two guards on this database do not
-- appear in schema.prisma and drift detection would offer to drop them.

CREATE TABLE "NationalIdStockEntry" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "originalAdded" INTEGER NOT NULL DEFAULT 0,
    "copyAdded" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "receivedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NationalIdStockEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NationalIdStockEntry_locationId_idx" ON "NationalIdStockEntry"("locationId");
CREATE INDEX "NationalIdStockEntry_createdAt_idx" ON "NationalIdStockEntry"("createdAt");

ALTER TABLE "NationalIdStockEntry"
    ADD CONSTRAINT "NationalIdStockEntry_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NationalIdStockEntry"
    ADD CONSTRAINT "NationalIdStockEntry_receivedById_fkey"
    FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An arrival that adds nothing is not an arrival, and blanks cannot arrive in
-- negative quantities.
ALTER TABLE "NationalIdStockEntry"
    ADD CONSTRAINT "NationalIdStockEntry_added_sane"
    CHECK ("originalAdded" >= 0 AND "copyAdded" >= 0 AND ("originalAdded" + "copyAdded") > 0);
