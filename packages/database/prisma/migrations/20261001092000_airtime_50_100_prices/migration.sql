-- Airtime 50 sells for 950 a carta and airtime 100 for 1,900.
UPDATE "Product" p
   SET "price" = CASE v."denomination" WHEN 50 THEN 950 WHEN 100 THEN 1900 ELSE p."price" END
  FROM "VoucherProduct" v
 WHERE v."productId" = p."id"
   AND p."category" = 'AIRTIME_VOUCHER'
   AND v."denomination" IN (50, 100);
