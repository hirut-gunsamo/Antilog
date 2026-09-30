-- Office equipment held by a branch: computers, printers, desks, paper.
--
-- Kept apart from the goods the business sells. Equipment is never issued to
-- a salesperson, never sold and never appears in takings, so putting it in
-- the product tables would put desks into the sales reports.
--
-- Hand-written like every migration here: guards exist on this database that
-- do not appear in schema.prisma, and drift detection would offer to drop them.

CREATE TYPE "AssetCategory" AS ENUM ('ELECTRONICS', 'FURNITURE', 'STATIONERY', 'OTHER');
CREATE TYPE "AssetStatus" AS ENUM ('IN_USE', 'DAMAGED', 'RETIRED');

CREATE TABLE "OfficeAsset" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "AssetCategory" NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'IN_USE',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "serialNumber" TEXT,
    "cost" DECIMAL(12,2),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficeAsset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OfficeAsset_locationId_idx" ON "OfficeAsset"("locationId");
CREATE INDEX "OfficeAsset_category_idx" ON "OfficeAsset"("category");
CREATE INDEX "OfficeAsset_status_idx" ON "OfficeAsset"("status");
CREATE INDEX "OfficeAsset_receivedAt_idx" ON "OfficeAsset"("receivedAt");

ALTER TABLE "OfficeAsset"
  ADD CONSTRAINT "OfficeAsset_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OfficeAsset"
  ADD CONSTRAINT "OfficeAsset_recordedById_fkey"
  FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A delivery of nothing is not a delivery, and a negative cost is a typo.
ALTER TABLE "OfficeAsset"
  ADD CONSTRAINT "OfficeAsset_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "OfficeAsset"
  ADD CONSTRAINT "OfficeAsset_cost_not_negative" CHECK ("cost" IS NULL OR "cost" >= 0);
