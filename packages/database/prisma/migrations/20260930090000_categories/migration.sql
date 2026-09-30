-- Categories the Owner manages: SIM Cards, Phones and Airtime to start, and
-- any others added later (Accessories, say).
--
-- A category's `kind` decides how its goods behave. The three built-in kinds
-- keep their rules (ICCID on SIM cards, IMEI on phones, a value on airtime);
-- a category the Owner adds is OTHER: counted and sold by quantity and price.
--
-- Hand-written like every migration here: guards exist on this database that
-- do not appear in schema.prisma.

ALTER TYPE "ProductCategory" ADD VALUE IF NOT EXISTS 'OTHER';

CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ProductCategory" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

INSERT INTO "Category" ("id", "name", "kind", "updatedAt") VALUES
    ('cat_sim',     'SIM Cards', 'SIM_CARD',        CURRENT_TIMESTAMP),
    ('cat_phone',   'Phones',    'PHONE',           CURRENT_TIMESTAMP),
    ('cat_airtime', 'Airtime',   'AIRTIME_VOUCHER', CURRENT_TIMESTAMP);

-- Types and products point at their category.
ALTER TABLE "ProductType" ADD COLUMN "categoryId" TEXT;
ALTER TABLE "Product"     ADD COLUMN "categoryId" TEXT;

UPDATE "ProductType" SET "categoryId" = CASE "category"::text
    WHEN 'SIM_CARD' THEN 'cat_sim'
    WHEN 'PHONE' THEN 'cat_phone'
    ELSE 'cat_airtime' END
  WHERE "categoryId" IS NULL;

UPDATE "Product" SET "categoryId" = CASE "category"::text
    WHEN 'SIM_CARD' THEN 'cat_sim'
    WHEN 'PHONE' THEN 'cat_phone'
    ELSE 'cat_airtime' END
  WHERE "categoryId" IS NULL;

CREATE INDEX "ProductType_categoryId_idx" ON "ProductType"("categoryId");
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

ALTER TABLE "ProductType" ADD CONSTRAINT "ProductType_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Type names are unique within a category now, not within a kind: two
-- general categories may both have a "Samsung".
DROP INDEX IF EXISTS "ProductType_category_parentId_name_key";
DROP INDEX IF EXISTS "ProductType_category_name_root_key";

CREATE UNIQUE INDEX "ProductType_categoryId_parentId_name_key"
    ON "ProductType"("categoryId", "parentId", "name");
CREATE UNIQUE INDEX "ProductType_categoryId_name_root_key"
    ON "ProductType"("categoryId", "name")
    WHERE "parentId" IS NULL;
