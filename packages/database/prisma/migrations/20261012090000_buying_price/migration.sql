-- Profit and loss: what the business pays for each product, and that cost
-- kept on every sale line as it stood when sold.
ALTER TABLE "Product" ADD COLUMN "costPrice" DECIMAL(12,2);
ALTER TABLE "Product" ADD CONSTRAINT "Product_costPrice_check" CHECK ("costPrice" IS NULL OR "costPrice" >= 0);

ALTER TABLE "SaleItem" ADD COLUMN "unitCost" DECIMAL(12,2);
