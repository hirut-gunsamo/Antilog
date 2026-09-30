-- When to tell a salesperson their own stock is running low.
--
-- The existing low-stock warning is about the branch's shelves. This one is
-- about what the seller is carrying: the figure that decides whether the next
-- customer is served or turned away. Per category, because five phones and
-- five vouchers are not the same kind of "five".
--
-- Hand-written like every migration here: guards exist on this database that
-- do not appear in schema.prisma, and drift detection would offer to drop them.

ALTER TABLE "AppSetting" ADD COLUMN "lowHoldingSim" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "AppSetting" ADD COLUMN "lowHoldingPhone" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "AppSetting" ADD COLUMN "lowHoldingVoucher" INTEGER NOT NULL DEFAULT 20;

-- A level of zero would mean "never warn", which is a legitimate choice; a
-- negative one is a mistake.
ALTER TABLE "AppSetting"
  ADD CONSTRAINT "AppSetting_low_holding_not_negative"
  CHECK ("lowHoldingSim" >= 0 AND "lowHoldingPhone" >= 0 AND "lowHoldingVoucher" >= 0);
