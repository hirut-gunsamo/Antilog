-- A salesperson's correction of how a sale was paid (a mistyped transfer
-- amount), waiting for the Owner to approve it.
ALTER TABLE "Sale" ADD COLUMN "payFixRequestedAt" TIMESTAMP(3);
ALTER TABLE "Sale" ADD COLUMN "payFixMethod" "PaymentMethod";
ALTER TABLE "Sale" ADD COLUMN "payFixCash" DECIMAL(12,2);
ALTER TABLE "Sale" ADD COLUMN "payFixTransfer" DECIMAL(12,2);
ALTER TABLE "Sale" ADD COLUMN "payFixBank" TEXT;
ALTER TABLE "Sale" ADD COLUMN "payFixNote" TEXT;
