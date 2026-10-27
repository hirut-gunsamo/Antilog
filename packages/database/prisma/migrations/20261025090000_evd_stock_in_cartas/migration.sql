-- Airtime is stocked by the carta (20 cards). EVD prints already put into
-- stock were counted in single cards: take the difference back out so each
-- print counts as whole cartas, never below nothing.
DO $$
DECLARE
  p RECORD;
  extra INT;
BEGIN
  FOR p IN
    SELECT id, "locationId", "productId", "stockedAtId", cards
    FROM "IbidPrint"
    WHERE "productId" IS NOT NULL AND "stockedAtId" IS NOT NULL
  LOOP
    extra := p.cards - (p.cards / 20);
    CONTINUE WHEN extra <= 0;

    UPDATE "InventoryBalance"
    SET quantity = GREATEST(0, quantity - extra), "updatedAt" = now()
    WHERE "locationId" = p."stockedAtId" AND "productId" = p."productId";

    IF p."stockedAtId" <> p."locationId" THEN
      UPDATE "BranchStock"
      SET quantity = GREATEST(0, quantity - extra), "updatedAt" = now()
      WHERE "branchId" = p."locationId" AND "productId" = p."productId";
    END IF;
  END LOOP;
END $$;
