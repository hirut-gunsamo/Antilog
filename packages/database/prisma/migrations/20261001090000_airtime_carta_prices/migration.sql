-- Airtime is sold by the carta at a fixed price per value:
--   10 -> 190, 15 -> 285, 25 -> 475, 50 -> 490, 100 -> 900.
-- An airtime product's price is the price of one carta, and a unit of airtime
-- stock, request or sale is one carta.
--
-- Hand-written like every migration here: guards exist on this database that
-- do not appear in schema.prisma.

UPDATE "Product" p
   SET "price" = CASE v."denomination"
         WHEN 10  THEN 190
         WHEN 15  THEN 285
         WHEN 25  THEN 475
         WHEN 50  THEN 490
         WHEN 100 THEN 900
         ELSE p."price" END
  FROM "VoucherProduct" v
 WHERE v."productId" = p."id"
   AND p."category" = 'AIRTIME_VOUCHER';
