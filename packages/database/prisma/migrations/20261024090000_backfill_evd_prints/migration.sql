-- EVD printed before printed cards became stock: add each print's cards now.
-- A supervisor's print goes onto that branch's shelf; the Owner's goes into
-- the main store, in that branch's share. A print with no airtime product of
-- its value is left as it was.
DO $$
DECLARE
  p RECORD;
  product_id TEXT;
  store_id TEXT;
  target TEXT;
BEGIN
  SELECT id INTO store_id FROM "StockLocation"
  WHERE "isMainStock" = true AND "isActive" = true
  ORDER BY "createdAt" ASC LIMIT 1;

  FOR p IN
    SELECT ip.id, ip."locationId", ip.cards, ip.denomination, ip."printedById", u.role::text AS role
    FROM "IbidPrint" ip
    JOIN "User" u ON u.id = ip."printedById"
    WHERE ip."productId" IS NULL
  LOOP
    SELECT pr.id INTO product_id
    FROM "Product" pr
    JOIN "VoucherProduct" v ON v."productId" = pr.id
    LEFT JOIN "ProductType" ty ON ty.id = pr."typeId"
    WHERE v.denomination = p.denomination
      AND pr.status = 'ACTIVE'
      AND pr.category = 'AIRTIME_VOUCHER'
    ORDER BY ((pr.name || ' ' || pr.sku || ' ' || coalesce(ty.name, '')) ~* '(evd|card|ibid)') DESC, pr."createdAt" ASC
    LIMIT 1;

    CONTINUE WHEN product_id IS NULL;

    target := CASE WHEN p.role = 'OWNER' AND store_id IS NOT NULL THEN store_id ELSE p."locationId" END;

    INSERT INTO "InventoryBalance" (id, "locationId", "productId", quantity, "createdAt", "updatedAt")
    VALUES (md5(random()::text || clock_timestamp()::text), target, product_id, p.cards, now(), now())
    ON CONFLICT ("locationId", "productId")
    DO UPDATE SET quantity = "InventoryBalance".quantity + EXCLUDED.quantity, "updatedAt" = now();

    IF target <> p."locationId" THEN
      INSERT INTO "BranchStock" (id, "branchId", "productId", quantity, "createdAt", "updatedAt")
      VALUES (md5(random()::text || clock_timestamp()::text), p."locationId", product_id, p.cards, now(), now())
      ON CONFLICT ("branchId", "productId")
      DO UPDATE SET quantity = "BranchStock".quantity + EXCLUDED.quantity, "updatedAt" = now();
    END IF;

    INSERT INTO "StockMovement" (id, "productId", "toLocationId", quantity, type, "createdById", notes, "createdAt")
    VALUES (md5(random()::text || clock_timestamp()::text), product_id, target, p.cards, 'STOCK_IN', p."printedById",
            'EVD printed (added to stock)', now());

    UPDATE "IbidPrint" SET "productId" = product_id, "stockedAtId" = target WHERE id = p.id;
  END LOOP;
END $$;
