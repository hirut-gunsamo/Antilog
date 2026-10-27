-- Each branch has its own EVD balance, so a load goes to one branch.
-- Loads made before this have no branch and count towards none.
ALTER TABLE "IbidLoad" ADD COLUMN "locationId" TEXT;

CREATE INDEX "IbidLoad_locationId_idx" ON "IbidLoad"("locationId");

ALTER TABLE "IbidLoad" ADD CONSTRAINT "IbidLoad_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
