-- National ID printing: a service each branch performs and records daily.
--
-- Hand-written rather than generated, like every migration here: the database
-- carries two guards that do not appear in schema.prisma, and drift detection
-- would offer to drop them.

ALTER TABLE "AppSetting"
    ADD COLUMN "nationalIdOriginalRate" DECIMAL(12,2) NOT NULL DEFAULT 5,
    ADD COLUMN "nationalIdCopyRate" DECIMAL(12,2) NOT NULL DEFAULT 5;

CREATE TABLE "NationalIdRecord" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "locationId" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "originalCount" INTEGER NOT NULL DEFAULT 0,
    "copyCount" INTEGER NOT NULL DEFAULT 0,
    "originalRate" DECIMAL(12,2) NOT NULL,
    "copyRate" DECIMAL(12,2) NOT NULL,
    "revenue" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NationalIdRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NationalIdRecord_locationId_idx" ON "NationalIdRecord"("locationId");
CREATE INDEX "NationalIdRecord_date_idx" ON "NationalIdRecord"("date");
CREATE INDEX "NationalIdRecord_recordedById_idx" ON "NationalIdRecord"("recordedById");

ALTER TABLE "NationalIdRecord"
    ADD CONSTRAINT "NationalIdRecord_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NationalIdRecord"
    ADD CONSTRAINT "NationalIdRecord_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A day's work is one row per employee per branch. Entering the same day twice
-- is a mistake, not a second shift, so the database refuses it outright.
CREATE UNIQUE INDEX "NationalIdRecord_branch_employee_day"
    ON "NationalIdRecord"("locationId", "recordedById", "date");

-- Counts are never negative, and a row that records nothing is not a record.
ALTER TABLE "NationalIdRecord"
    ADD CONSTRAINT "NationalIdRecord_counts_sane"
    CHECK ("originalCount" >= 0 AND "copyCount" >= 0 AND ("originalCount" + "copyCount") > 0);
