-- The Owner lets a salesperson correct one past day.
CREATE TABLE "EditGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EditGrant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EditGrant_userId_day_key" ON "EditGrant"("userId", "day");
ALTER TABLE "EditGrant" ADD CONSTRAINT "EditGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
