-- The Owner's stock at the main store, split by the branch it is for.
CREATE TABLE "BranchStock" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchStock_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BranchStock_quantity_check" CHECK ("quantity" >= 0)
);

CREATE UNIQUE INDEX "BranchStock_branchId_productId_key" ON "BranchStock"("branchId", "productId");
CREATE INDEX "BranchStock_productId_idx" ON "BranchStock"("productId");

ALTER TABLE "BranchStock" ADD CONSTRAINT "BranchStock_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "StockLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BranchStock" ADD CONSTRAINT "BranchStock_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Start fresh, as the Owner chose: stock at the main stores was not split by
-- branch, so it is cleared and added again per branch.
UPDATE "InventoryBalance" b
SET "quantity" = 0
FROM "StockLocation" l
WHERE b."locationId" = l."id" AND l."isMainStock" = true;
