-- A commission line is now worked out, not typed: the item (a product), how
-- many, its price, and the commission percent. amount = quantity x price x
-- percent / 100. Lines saved before this keep their amount and have no
-- quantity or percent.
--
-- Hand-written like every migration here: guards exist on this database that
-- do not appear in schema.prisma.

ALTER TABLE "CommissionLine" ADD COLUMN "productId" TEXT;
ALTER TABLE "CommissionLine" ADD COLUMN "quantity" INTEGER;
ALTER TABLE "CommissionLine" ADD COLUMN "unitPrice" DECIMAL(12,2);
ALTER TABLE "CommissionLine" ADD COLUMN "percent" DECIMAL(6,2);

ALTER TABLE "CommissionLine" ADD CONSTRAINT "CommissionLine_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
