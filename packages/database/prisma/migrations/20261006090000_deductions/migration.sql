-- Deductions: money taken off someone's pay for goods short or lost on a day.
CREATE TABLE "Deduction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deduction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeductionLine" (
    "id" TEXT NOT NULL,
    "deductionId" TEXT NOT NULL,
    "productId" TEXT,
    "label" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "DeductionLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Deduction_userId_idx" ON "Deduction"("userId");
CREATE INDEX "Deduction_day_idx" ON "Deduction"("day");
CREATE INDEX "DeductionLine_deductionId_idx" ON "DeductionLine"("deductionId");
CREATE INDEX "DeductionLine_productId_idx" ON "DeductionLine"("productId");

ALTER TABLE "Deduction" ADD CONSTRAINT "Deduction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Deduction" ADD CONSTRAINT "Deduction_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeductionLine" ADD CONSTRAINT "DeductionLine_deductionId_fkey" FOREIGN KEY ("deductionId") REFERENCES "Deduction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeductionLine" ADD CONSTRAINT "DeductionLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
