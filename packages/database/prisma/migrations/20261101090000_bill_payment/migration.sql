-- Bills a customer pays through a sale (WiFi, electricity, water...): money
-- taken like a SIM transfer, counted in the sale's total.
CREATE TABLE "SaleBillPayment" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "billType" TEXT NOT NULL,
    "account" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SaleBillPayment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SaleBillPayment_saleId_idx" ON "SaleBillPayment"("saleId");
ALTER TABLE "SaleBillPayment" ADD CONSTRAINT "SaleBillPayment_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
