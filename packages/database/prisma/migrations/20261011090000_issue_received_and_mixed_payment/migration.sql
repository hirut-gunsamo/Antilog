-- 1. A salesperson confirms goods issued to them. Until they press Received,
--    the approved goods are reserved on the branch shelf but not yet theirs.
ALTER TABLE "StockRequest"
  ADD COLUMN "receivedAt" TIMESTAMP(3),
  ADD COLUMN "receivedById" TEXT;

ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_receivedById_fkey"
    FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Issues approved before this existed were credited to the salesperson on
-- approval, so they count as received then. Without this, pressing Received
-- on them would credit the goods a second time.
UPDATE "StockRequest" r
   SET "receivedAt" = COALESCE(r."reviewedAt", r."updatedAt"),
       "receivedById" = r."requestedById"
  FROM "User" u
 WHERE u.id = r."requestedById"
   AND u.role = 'SALES'
   AND r.kind = 'ISSUE'
   AND r.status IN ('APPROVED', 'FULFILLED');

-- 2. A sale paid part in cash and part by transfer. Like TRANSFER it names
--    the bank, which "Sale_transfer_has_bank" already requires of anything
--    but CASH.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'MIXED';
