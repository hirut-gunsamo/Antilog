-- Partial approval of restock requests.
--
-- A reviewer may agree to send less than was asked for (50 requested, 40
-- approved). `quantity` stays the amount requested; the new column records
-- what was approved, and the transfer ships that.
--
-- Hand-written like every migration here: two guards on this database do not
-- appear in schema.prisma and drift detection would offer to drop them.

ALTER TABLE "StockRequestItem" ADD COLUMN "approvedQuantity" INTEGER;

-- Until now approval was all-or-nothing, so every line of an approved or
-- fulfilled request was approved in full.
UPDATE "StockRequestItem" AS item
SET "approvedQuantity" = item."quantity"
FROM "StockRequest" AS request
WHERE request."id" = item."requestId"
  AND request."status" IN ('APPROVED', 'FULFILLED');
