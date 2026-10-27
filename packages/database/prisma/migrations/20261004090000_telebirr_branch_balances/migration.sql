-- Each branch has its own Telebirr account, so a load goes to one branch.
-- Loads made before this have no branch and count towards none.
ALTER TABLE "TelebirrLoad" ADD COLUMN "locationId" TEXT;

CREATE INDEX "TelebirrLoad_locationId_idx" ON "TelebirrLoad"("locationId");

ALTER TABLE "TelebirrLoad" ADD CONSTRAINT "TelebirrLoad_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
