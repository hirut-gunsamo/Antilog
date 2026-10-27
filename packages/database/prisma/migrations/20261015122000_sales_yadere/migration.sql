-- A salesperson's daily cash left in hand (yadere), entered separately
-- from item handback.

CREATE TABLE "SalesYadere" (
    "id" TEXT NOT NULL,
    "salespersonId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesYadere_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesYadere_salespersonId_day_key"
  ON "SalesYadere"("salespersonId", "day");

CREATE INDEX "SalesYadere_day_idx" ON "SalesYadere"("day");
CREATE INDEX "SalesYadere_salespersonId_idx" ON "SalesYadere"("salespersonId");

ALTER TABLE "SalesYadere"
  ADD CONSTRAINT "SalesYadere_salespersonId_fkey"
  FOREIGN KEY ("salespersonId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SalesYadere"
  ADD CONSTRAINT "SalesYadere_amount_not_negative" CHECK ("amount" >= 0);
