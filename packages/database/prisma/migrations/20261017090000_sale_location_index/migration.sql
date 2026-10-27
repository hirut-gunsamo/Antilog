-- A supervisor's sales list reads one branch, newest first.
CREATE INDEX IF NOT EXISTS "Sale_locationId_saleDate_idx" ON "Sale"("locationId", "saleDate");
