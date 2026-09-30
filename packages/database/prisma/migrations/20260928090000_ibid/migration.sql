-- Ibid: digital airtime bought as a birr balance.
--
-- The Owner loads the main balance (IbidLoad). A branch supervisor prints Ibid
-- cards of one value for a birr amount (IbidPrint), which is taken off the
-- main balance. Balance = every load less every print. Printing is not
-- selling: cards sold are reported with the rest of the airtime.
--
-- Hand-written like every migration here: guards exist on this database that
-- do not appear in schema.prisma.

CREATE TABLE "IbidLoad" (
    "id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IbidLoad_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "IbidLoad_amount_positive" CHECK ("amount" > 0)
);

CREATE TABLE "IbidPrint" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "denomination" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "cards" INTEGER NOT NULL,
    "note" TEXT,
    "printedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IbidPrint_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "IbidPrint_amount_positive" CHECK ("amount" > 0 AND "cards" > 0 AND "denomination" > 0)
);

CREATE INDEX "IbidLoad_createdAt_idx" ON "IbidLoad"("createdAt");
CREATE INDEX "IbidPrint_locationId_idx" ON "IbidPrint"("locationId");
CREATE INDEX "IbidPrint_createdAt_idx" ON "IbidPrint"("createdAt");

ALTER TABLE "IbidLoad" ADD CONSTRAINT "IbidLoad_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IbidPrint" ADD CONSTRAINT "IbidPrint_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IbidPrint" ADD CONSTRAINT "IbidPrint_printedById_fkey"
    FOREIGN KEY ("printedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
