-- Deduction the pay could not cover is carried to the next salary.
ALTER TABLE "PayrollPayment" ADD COLUMN "carriedOver" DECIMAL(12,2) NOT NULL DEFAULT 0;
