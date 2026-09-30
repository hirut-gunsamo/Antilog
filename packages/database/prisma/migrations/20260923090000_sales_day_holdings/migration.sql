-- The salesperson's day: take items in the morning, sell them, hand back what
-- is left in the evening.
--
-- Selling happens at the office, so issued goods never leave the branch.
-- InventoryBalance is therefore untouched by an issue or a return; what
-- changes is who is answerable for the goods, which is what this table holds.
--
-- Hand-written like every migration here: guards exist on this database that
-- do not appear in schema.prisma, and drift detection would offer to drop them.

CREATE TYPE "StockRequestKind" AS ENUM ('RESTOCK', 'ISSUE', 'RETURN');

ALTER TABLE "StockRequest"
  ADD COLUMN "kind" "StockRequestKind" NOT NULL DEFAULT 'RESTOCK';

-- Every request raised until now was a branch restock.
CREATE INDEX "StockRequest_kind_idx" ON "StockRequest"("kind");

CREATE TABLE "SalespersonHolding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalespersonHolding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalespersonHolding_userId_productId_key"
  ON "SalespersonHolding"("userId", "productId");

CREATE INDEX "SalespersonHolding_userId_idx" ON "SalespersonHolding"("userId");
CREATE INDEX "SalespersonHolding_productId_idx" ON "SalespersonHolding"("productId");

ALTER TABLE "SalespersonHolding"
  ADD CONSTRAINT "SalespersonHolding_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SalespersonHolding"
  ADD CONSTRAINT "SalespersonHolding_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Nobody can be answerable for a negative quantity: a sale or a return that
-- would take a holding below zero is a mistake, and the database refuses it
-- even if a future code path forgets to check.
ALTER TABLE "SalespersonHolding"
  ADD CONSTRAINT "SalespersonHolding_quantity_not_negative" CHECK ("quantity" >= 0);
