-- A commission line can be for any of the Owner's categories (including ones
-- they added) or for National ID work. Each line keeps its category, when it
-- has one, and the name it was paid under, so reports read the same later.
--
-- Hand-written like every migration here: guards exist on this database that
-- do not appear in schema.prisma.

ALTER TABLE "CommissionLine" ADD COLUMN "categoryId" TEXT;
ALTER TABLE "CommissionLine" ADD COLUMN "label" TEXT;

UPDATE "CommissionLine" SET
    "categoryId" = CASE "category"::text
        WHEN 'SIM_CARD' THEN 'cat_sim'
        WHEN 'PHONE' THEN 'cat_phone'
        WHEN 'AIRTIME_VOUCHER' THEN 'cat_airtime'
        ELSE NULL END,
    "label" = CASE "category"::text
        WHEN 'SIM_CARD' THEN 'SIM Cards'
        WHEN 'PHONE' THEN 'Phones'
        WHEN 'AIRTIME_VOUCHER' THEN 'Airtime'
        ELSE 'Other' END
  WHERE "label" IS NULL;

ALTER TABLE "CommissionLine" ADD CONSTRAINT "CommissionLine_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
