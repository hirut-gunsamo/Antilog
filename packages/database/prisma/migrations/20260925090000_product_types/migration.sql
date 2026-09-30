-- The level between a fixed category and a sellable product: a brand, a
-- voucher type, a phone model.
--
-- Self-referencing rather than one table per level, because SIM and voucher
-- types are one level deep while phones are two, and a third level may be
-- wanted later without another migration.
--
-- Hand-written like every migration here: guards exist on this database that
-- do not appear in schema.prisma, and drift detection would offer to drop them.

CREATE TABLE "ProductType" (
    "id" TEXT NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductType_pkey" PRIMARY KEY ("id")
);

-- A NULL parentId does not compare equal to another NULL, so this index alone
-- would let the same top-level brand be added twice. The partial index below
-- closes that.
CREATE UNIQUE INDEX "ProductType_category_parentId_name_key"
    ON "ProductType"("category", "parentId", "name");

CREATE UNIQUE INDEX "ProductType_category_name_root_key"
    ON "ProductType"("category", "name")
    WHERE "parentId" IS NULL;

CREATE INDEX "ProductType_category_idx" ON "ProductType"("category");
CREATE INDEX "ProductType_parentId_idx" ON "ProductType"("parentId");

ALTER TABLE "ProductType"
    ADD CONSTRAINT "ProductType_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "ProductType"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Nullable: existing products have no type yet, and a later step attaches them.
ALTER TABLE "Product" ADD COLUMN "typeId" TEXT;

CREATE INDEX "Product_typeId_idx" ON "Product"("typeId");

ALTER TABLE "Product"
    ADD CONSTRAINT "Product_typeId_fkey"
    FOREIGN KEY ("typeId") REFERENCES "ProductType"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- The types the business already works with.
INSERT INTO "ProductType" ("id", "category", "parentId", "name", "updatedAt") VALUES
    ('pt_sim_standard',  'SIM_CARD',        NULL, 'Standard', CURRENT_TIMESTAMP),
    ('pt_sim_esim',      'SIM_CARD',        NULL, 'eSIM',     CURRENT_TIMESTAMP),
    ('pt_av_ibid',       'AIRTIME_VOUCHER', NULL, 'Ibid',     CURRENT_TIMESTAMP),
    ('pt_av_voucher',    'AIRTIME_VOUCHER', NULL, 'Voucher',  CURRENT_TIMESTAMP),
    ('pt_av_wereket',    'AIRTIME_VOUCHER', NULL, 'Wereket',  CURRENT_TIMESTAMP);
