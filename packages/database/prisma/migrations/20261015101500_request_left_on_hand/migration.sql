-- Optional money a salesperson still has when handing back items in the evening.
-- This is the same day's yadere candidate for the supervisor to collect.

ALTER TABLE "StockRequest"
  ADD COLUMN "leftOnHand" DECIMAL(12,2);

ALTER TABLE "StockRequest"
  ADD CONSTRAINT "StockRequest_leftOnHand_not_negative"
  CHECK ("leftOnHand" IS NULL OR "leftOnHand" >= 0);
