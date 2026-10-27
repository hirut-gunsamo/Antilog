-- Selling prices can differ by branch. A branch with no row here sells at the
-- product's own price, which stays the default.
CREATE TABLE "ProductBranchPrice" (
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductBranchPrice_pkey" PRIMARY KEY ("productId", "locationId"),
    CONSTRAINT "ProductBranchPrice_price_check" CHECK ("price" >= 0)
);

CREATE INDEX "ProductBranchPrice_locationId_idx" ON "ProductBranchPrice"("locationId");

ALTER TABLE "ProductBranchPrice" ADD CONSTRAINT "ProductBranchPrice_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductBranchPrice" ADD CONSTRAINT "ProductBranchPrice_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
