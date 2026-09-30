-- Branch lifecycle: branches are created and retired through the app, not by
-- running seed scripts. The number of branches is unbounded.
--
-- Additive only. No column is dropped and no row is deleted.

-- Closed branches are deactivated rather than deleted, so their inventory,
-- sales history and reports remain intact and reportable.
ALTER TABLE "StockLocation" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- Branch names must be unambiguous: staff pick a branch by name in every
-- dropdown, request and report.
CREATE UNIQUE INDEX "StockLocation_name_key" ON "StockLocation"("name");

-- At least one active main-stock branch must exist, or supervisors would have
-- nowhere to request stock from. Several are allowed.
DO $$
DECLARE
  active_main INT;
  branch_count INT;
BEGIN
  SELECT COUNT(*) INTO branch_count FROM "StockLocation";

  -- A database with no branches at all is a new installation: its Owner
  -- creates the branches in the app, which enforces this same rule. Only a
  -- system that already has branches can be left without a stock source.
  IF branch_count = 0 THEN
    RAISE NOTICE 'No branches yet: new installation, nothing to check.';
    RETURN;
  END IF;

  SELECT COUNT(*) INTO active_main
  FROM "StockLocation"
  WHERE "isMainStock" = true AND "isActive" = true;

  IF active_main < 1 THEN
    RAISE EXCEPTION
      'Expected at least 1 active main-stock branch, found %.', active_main;
  END IF;
END $$;
