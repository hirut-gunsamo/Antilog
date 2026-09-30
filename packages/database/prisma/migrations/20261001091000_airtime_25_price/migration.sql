-- Airtime 25 sells for 485 a carta, not 475.
UPDATE "Product" p
   SET "price" = 485
  FROM "VoucherProduct" v
 WHERE v."productId" = p."id"
   AND p."category" = 'AIRTIME_VOUCHER'
   AND v."denomination" = 25;
