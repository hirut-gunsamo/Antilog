-- A SIM transfer is recorded as a count: the details are kept in Ethio
-- telecom's own system.
ALTER TABLE "SaleSimTransfer" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SaleSimTransfer" ALTER COLUMN "fromName" DROP NOT NULL;
ALTER TABLE "SaleSimTransfer" ALTER COLUMN "phoneNumber" DROP NOT NULL;
ALTER TABLE "SaleSimTransfer" ALTER COLUMN "toName" DROP NOT NULL;
