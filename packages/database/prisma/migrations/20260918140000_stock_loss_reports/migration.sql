-- Damage and loss reporting.
--
-- Written by hand rather than through `migrate dev`: this database carries two
-- guards that do not appear in schema.prisma (the one-active-supervisor index
-- and the owner-has-no-branch check), and drift detection would offer to drop
-- them.

CREATE TYPE "StockLossKind" AS ENUM ('DAMAGED', 'LOST');

CREATE TYPE "StockLossStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "StockLossReport" (
    "id" TEXT NOT NULL,
    "kind" "StockLossKind" NOT NULL,
    "status" "StockLossStatus" NOT NULL DEFAULT 'PENDING',
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLossReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StockLossReport_locationId_idx" ON "StockLossReport"("locationId");
CREATE INDEX "StockLossReport_status_idx" ON "StockLossReport"("status");
CREATE INDEX "StockLossReport_reportedById_idx" ON "StockLossReport"("reportedById");
CREATE INDEX "StockLossReport_createdAt_idx" ON "StockLossReport"("createdAt");

ALTER TABLE "StockLossReport"
    ADD CONSTRAINT "StockLossReport_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockLossReport"
    ADD CONSTRAINT "StockLossReport_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockLossReport"
    ADD CONSTRAINT "StockLossReport_reportedById_fkey"
    FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockLossReport"
    ADD CONSTRAINT "StockLossReport_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A serialised unit remembers which report wrote it off, so a rejection can
-- put exactly those units back rather than guessing from the quantity.
ALTER TABLE "InventoryUnit" ADD COLUMN "lossReportId" TEXT;

CREATE INDEX "InventoryUnit_lossReportId_idx" ON "InventoryUnit"("lossReportId");

ALTER TABLE "InventoryUnit"
    ADD CONSTRAINT "InventoryUnit_lossReportId_fkey"
    FOREIGN KEY ("lossReportId") REFERENCES "StockLossReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
