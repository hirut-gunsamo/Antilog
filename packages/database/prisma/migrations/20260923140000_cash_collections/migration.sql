-- Cash handed from a salesperson to their supervisor.
--
-- Until now the money went straight from the seller to the bank on paper.
-- In practice the supervisor collects it during the day, banks it before the
-- bank shuts, and carries whatever came in afterwards overnight. Recording the
-- handover is what lets the system say who is holding what at any hour, and
-- what the yadere is.
--
-- Hand-written like every migration here: guards exist on this database that
-- do not appear in schema.prisma, and drift detection would offer to drop them.

CREATE TABLE "CashCollection" (
    "id" TEXT NOT NULL,
    "supervisorId" TEXT NOT NULL,
    "salespersonId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashCollection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CashCollection_supervisorId_idx" ON "CashCollection"("supervisorId");
CREATE INDEX "CashCollection_salespersonId_idx" ON "CashCollection"("salespersonId");
CREATE INDEX "CashCollection_collectedAt_idx" ON "CashCollection"("collectedAt");

ALTER TABLE "CashCollection"
  ADD CONSTRAINT "CashCollection_supervisorId_fkey"
  FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CashCollection"
  ADD CONSTRAINT "CashCollection_salespersonId_fkey"
  FOREIGN KEY ("salespersonId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A handover moves money; it is never zero or negative, and nobody hands cash
-- to themselves.
ALTER TABLE "CashCollection"
  ADD CONSTRAINT "CashCollection_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "CashCollection"
  ADD CONSTRAINT "CashCollection_not_self" CHECK ("supervisorId" <> "salespersonId");
