-- Payroll: monthly salaries, commission on sales, and the record of what was
-- paid each month.
--
-- Commission is not fixed. The Owner sets a rate per product category, either
-- a percentage of the sales or birr per item sold, and may give one employee
-- a different rate. The month's commission is worked out from that person's
-- approved sales; a payment keeps a copy of the figures as they were paid.
--
-- Hand-written like every migration here: guards exist on this database that
-- do not appear in schema.prisma.

ALTER TABLE "User" ADD COLUMN "monthlySalary" DECIMAL(12,2);

CREATE TABLE "CommissionRate" (
    "id" TEXT NOT NULL,
    "category" "ProductCategory" NOT NULL,
    -- Null: the rate for everyone. Set: this employee's own rate.
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionRate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CommissionRate_kind_check" CHECK ("kind" IN ('PERCENT', 'PER_UNIT')),
    CONSTRAINT "CommissionRate_value_check" CHECK ("value" >= 0)
);

-- One rate per category per employee, and one everyone-rate per category
-- (NULLs never clash in a plain unique index, hence the partial one).
CREATE UNIQUE INDEX "CommissionRate_category_userId_key" ON "CommissionRate"("category", "userId");
CREATE UNIQUE INDEX "CommissionRate_category_default_key" ON "CommissionRate"("category") WHERE "userId" IS NULL;

ALTER TABLE "CommissionRate" ADD CONSTRAINT "CommissionRate_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PayrollPayment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    -- "2026-09"
    "month" TEXT NOT NULL,
    "salary" DECIMAL(12,2) NOT NULL,
    "commission" DECIMAL(12,2) NOT NULL,
    "bonus" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "paidById" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollPayment_userId_month_key" ON "PayrollPayment"("userId", "month");
CREATE INDEX "PayrollPayment_month_idx" ON "PayrollPayment"("month");

ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_paidById_fkey"
    FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
