-- Airtime sells by the carta (20 cards) at 5% off: price = value x 20 x 0.95,
-- i.e. value x 19. 10 -> 190, 15 -> 285, 25 -> 475, 50 -> 950, 100 -> 1,900.
UPDATE "Product" p
   SET "price" = v."denomination" * 19
  FROM "VoucherProduct" v
 WHERE v."productId" = p."id"
   AND p."category" = 'AIRTIME_VOUCHER';
