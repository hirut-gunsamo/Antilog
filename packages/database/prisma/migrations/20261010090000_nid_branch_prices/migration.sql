-- National ID prices can differ by branch. A branch with no row here charges
-- the Owner's default prices in AppSetting.

CREATE TABLE "NationalIdBranchPrice" (
    "locationId" TEXT NOT NULL,
    "originalRate" DECIMAL(12,2) NOT NULL,
    "copyRate" DECIMAL(12,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NationalIdBranchPrice_pkey" PRIMARY KEY ("locationId"),
    CONSTRAINT "NationalIdBranchPrice_rates_check" CHECK ("originalRate" >= 0 AND "copyRate" >= 0)
);

ALTER TABLE "NationalIdBranchPrice" ADD CONSTRAINT "NationalIdBranchPrice_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
