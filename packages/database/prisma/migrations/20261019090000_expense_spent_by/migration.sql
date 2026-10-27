-- Whose cash paid an expense, so it comes off that person's cash on hand.
ALTER TABLE "Expense" ADD COLUMN "spentById" TEXT;
ALTER TABLE "Expense"
  ADD CONSTRAINT "Expense_spentById_fkey"
  FOREIGN KEY ("spentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Expense_spentById_idx" ON "Expense"("spentById");
