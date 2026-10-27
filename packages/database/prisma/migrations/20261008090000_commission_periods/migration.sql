-- Each commission line keeps the stretch of sales it paid for, so the next
-- commission counts only sales after it.
ALTER TABLE "CommissionLine" ADD COLUMN "periodStart" TIMESTAMP(3);
ALTER TABLE "CommissionLine" ADD COLUMN "periodEnd" TIMESTAMP(3);
