-- A sale is paid in cash or by bank transfer. Transfer money goes straight to
-- the bank, so it is kept apart from cashReceived (the cash the seller holds
-- and hands in) and never counts as cash in hand.
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'TRANSFER');

ALTER TABLE "Sale"
  ADD COLUMN "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
  ADD COLUMN "bankName" TEXT,
  ADD COLUMN "transferReceived" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_transfer_has_bank"
  CHECK ("paymentMethod" = 'CASH' OR "bankName" IS NOT NULL);
