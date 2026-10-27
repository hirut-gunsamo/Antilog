-- How the customer paid for a National ID order or a Telebirr entry, so the
-- daily money splits them into cash and transfer like item sales. Everything
-- recorded before this was cash.
ALTER TABLE "NationalIdOrder"
  ADD COLUMN "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
  ADD COLUMN "transferAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "bankName" TEXT;
ALTER TABLE "NationalIdOrder"
  ADD CONSTRAINT "NationalIdOrder_paymentMethod_check"
  CHECK ("paymentMethod" IN ('CASH', 'TRANSFER', 'MIXED'));

ALTER TABLE "TelebirrTransaction"
  ADD COLUMN "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
  ADD COLUMN "transferAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "bankName" TEXT;
ALTER TABLE "TelebirrTransaction"
  ADD CONSTRAINT "TelebirrTransaction_paymentMethod_check"
  CHECK ("paymentMethod" IN ('CASH', 'TRANSFER', 'MIXED'));
