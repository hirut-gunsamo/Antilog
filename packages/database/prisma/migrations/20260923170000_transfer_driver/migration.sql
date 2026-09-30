-- Who is carrying a restock to the branch.
--
-- The Owner names the driver, their phone and the plate when approving, so the
-- receiving supervisor knows who to expect and can check the van against the
-- record before unloading.
--
-- Hand-written like every migration here: guards exist on this database that
-- do not appear in schema.prisma, and drift detection would offer to drop them.

ALTER TABLE "StockTransfer" ADD COLUMN "driverName" TEXT;
ALTER TABLE "StockTransfer" ADD COLUMN "driverPhone" TEXT;
ALTER TABLE "StockTransfer" ADD COLUMN "vehiclePlate" TEXT;
