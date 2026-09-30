-- Bankers collect the day's cash at the office and credit the Owner's account
-- through their app, so a slip may or may not exist. The supervisor records
-- the amount credited; the file becomes optional.
--
-- Each record keeps the branch it is for, that day's sales at the time it was
-- entered, and what was left uncredited ("yadere", kept overnight).
--
-- Hand-written like every migration here: guards exist on this database that
-- do not appear in schema.prisma.

ALTER TABLE "BankReceipt" ALTER COLUMN "fileUrl" DROP NOT NULL;

ALTER TABLE "BankReceipt" ADD COLUMN "locationId" TEXT;
ALTER TABLE "BankReceipt" ADD COLUMN "daySales" DECIMAL(12,2);
ALTER TABLE "BankReceipt" ADD COLUMN "yadere" DECIMAL(12,2);

CREATE INDEX "BankReceipt_locationId_idx" ON "BankReceipt"("locationId");

ALTER TABLE "BankReceipt"
    ADD CONSTRAINT "BankReceipt_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing receipts belong to the branch of whoever uploaded them.
UPDATE "BankReceipt" r
   SET "locationId" = u."branchId"
  FROM "User" u
 WHERE u.id = r."uploadedById" AND r."locationId" IS NULL;
