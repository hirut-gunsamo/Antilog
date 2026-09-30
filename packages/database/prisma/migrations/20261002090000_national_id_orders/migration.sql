-- National ID printing and copying for customers, as it actually happens:
--
-- A salesperson registers each customer (full name) for an ORIGINAL print or
-- a COPY, at the price the Owner set. They send the waiting names as a
-- request to their supervisor, who forwards it to the Owner. The Owner prints
-- or copies and sends it back with the number done; the rest are leftovers,
-- which go out again with that salesperson's next request.
--
-- Hand-written like every migration here: guards exist on this database that
-- do not appear in schema.prisma.

CREATE TABLE "NationalIdRequest" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WITH_SUPERVISOR',
    "total" INTEGER NOT NULL,
    "doneCount" INTEGER,
    "leftoverCount" INTEGER,
    "note" TEXT,
    "forwardedById" TEXT,
    "forwardedAt" TIMESTAMP(3),
    "returnedById" TEXT,
    "returnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NationalIdRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "NationalIdRequest_kind_check" CHECK ("kind" IN ('ORIGINAL', 'COPY')),
    CONSTRAINT "NationalIdRequest_status_check" CHECK ("status" IN ('WITH_SUPERVISOR', 'WITH_OWNER', 'RETURNED'))
);

CREATE TABLE "NationalIdOrder" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "locationId" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REGISTERED',
    "requestId" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NationalIdOrder_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "NationalIdOrder_kind_check" CHECK ("kind" IN ('ORIGINAL', 'COPY')),
    CONSTRAINT "NationalIdOrder_status_check" CHECK ("status" IN ('REGISTERED', 'REQUESTED', 'AT_OWNER', 'DONE', 'LEFTOVER'))
);

CREATE INDEX "NationalIdRequest_locationId_idx" ON "NationalIdRequest"("locationId");
CREATE INDEX "NationalIdRequest_status_idx" ON "NationalIdRequest"("status");
CREATE INDEX "NationalIdOrder_locationId_idx" ON "NationalIdOrder"("locationId");
CREATE INDEX "NationalIdOrder_status_idx" ON "NationalIdOrder"("status");
CREATE INDEX "NationalIdOrder_requestId_idx" ON "NationalIdOrder"("requestId");

ALTER TABLE "NationalIdRequest" ADD CONSTRAINT "NationalIdRequest_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NationalIdRequest" ADD CONSTRAINT "NationalIdRequest_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NationalIdRequest" ADD CONSTRAINT "NationalIdRequest_forwardedById_fkey"
    FOREIGN KEY ("forwardedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NationalIdRequest" ADD CONSTRAINT "NationalIdRequest_returnedById_fkey"
    FOREIGN KEY ("returnedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NationalIdOrder" ADD CONSTRAINT "NationalIdOrder_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NationalIdOrder" ADD CONSTRAINT "NationalIdOrder_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NationalIdOrder" ADD CONSTRAINT "NationalIdOrder_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "NationalIdRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
