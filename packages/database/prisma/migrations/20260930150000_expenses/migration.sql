-- Expenses a branch pays out of pocket (transport, repairs, supplies...),
-- recorded by its supervisor with a reason. The Owner reads them as a report.
--
-- Hand-written like every migration here: guards exist on this database that
-- do not appear in schema.prisma.

CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Expense_amount_positive" CHECK ("amount" > 0)
);

CREATE INDEX "Expense_locationId_idx" ON "Expense"("locationId");
CREATE INDEX "Expense_expenseDate_idx" ON "Expense"("expenseDate");

ALTER TABLE "Expense" ADD CONSTRAINT "Expense_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
