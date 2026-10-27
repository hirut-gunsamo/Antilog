-- A salesperson receives each approved line of an issue as it is approved,
-- so a line approved early can be sold while the rest is still undecided.
ALTER TABLE "StockRequestItem" ADD COLUMN "receivedAt" TIMESTAMP(3);

-- Lines of issues already received as a whole count as received then, so
-- they are never credited a second time.
UPDATE "StockRequestItem" i
   SET "receivedAt" = r."receivedAt"
  FROM "StockRequest" r
 WHERE r.id = i."requestId"
   AND r."receivedAt" IS NOT NULL
   AND COALESCE(i."approvedQuantity", 0) > 0;
