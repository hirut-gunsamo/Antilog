-- The Owner reopens a checked receipt for correcting, for 24 hours.
ALTER TABLE "BankReceipt" ADD COLUMN "editAllowedUntil" TIMESTAMP(3);
ALTER TABLE "BankReceipt" ADD COLUMN "editRequestedAt" TIMESTAMP(3);
