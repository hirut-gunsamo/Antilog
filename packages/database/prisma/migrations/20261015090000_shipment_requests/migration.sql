-- One car per branch: several requests (one per category) can share one
-- shipment, so the supervisor receives them all at once.
ALTER TABLE "StockRequest" ADD COLUMN "shipmentId" TEXT;

ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_shipmentId_fkey"
    FOREIGN KEY ("shipmentId") REFERENCES "StockTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "StockRequest_shipmentId_idx" ON "StockRequest"("shipmentId");

-- Shipments made before this carried one request each.
UPDATE "StockRequest" r
   SET "shipmentId" = t.id
  FROM "StockTransfer" t
 WHERE t."requestId" = r.id;
