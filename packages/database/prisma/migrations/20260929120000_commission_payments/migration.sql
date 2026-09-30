-- Commission paid by hand: the Owner picks an employee and adds one line per
-- item they earned on (airtime, phones, SIM cards), each with its amount.
-- One person can earn on one item or several in the same payment.
--
-- Hand-written like every migration here: guards exist on this database that
-- do not appear in schema.prisma.

CREATE TABLE "CommissionPayment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    -- "2026-09"
    "month" TEXT NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "paidById" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommissionLine" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "CommissionLine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CommissionLine_amount_check" CHECK ("amount" > 0)
);

CREATE INDEX "CommissionPayment_month_idx" ON "CommissionPayment"("month");
CREATE INDEX "CommissionPayment_userId_idx" ON "CommissionPayment"("userId");
CREATE INDEX "CommissionLine_paymentId_idx" ON "CommissionLine"("paymentId");

ALTER TABLE "CommissionPayment" ADD CONSTRAINT "CommissionPayment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionPayment" ADD CONSTRAINT "CommissionPayment_paidById_fkey"
    FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionLine" ADD CONSTRAINT "CommissionLine_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "CommissionPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
