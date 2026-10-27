-- SIM transfers sold with a sale, at the Owner's fixed price.
ALTER TABLE "AppSetting" ADD COLUMN "simTransferPrice" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE TABLE "SaleSimTransfer" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "toName" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SaleSimTransfer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SaleSimTransfer_saleId_idx" ON "SaleSimTransfer"("saleId");
ALTER TABLE "SaleSimTransfer" ADD CONSTRAINT "SaleSimTransfer_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
