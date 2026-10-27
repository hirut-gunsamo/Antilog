-- Printed EVD cards become stock: which product, and where they were put.
ALTER TABLE "IbidPrint" ADD COLUMN "productId" TEXT;
ALTER TABLE "IbidPrint" ADD COLUMN "stockedAtId" TEXT;
