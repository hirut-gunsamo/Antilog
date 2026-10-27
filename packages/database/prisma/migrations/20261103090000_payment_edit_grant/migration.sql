-- A salesperson asks to correct how a day's sales were paid (a mistyped
-- transfer amount); the Owner opens it for 24 hours.
CREATE TABLE "PaymentEditGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3),
    "until" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentEditGrant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentEditGrant_userId_day_key" ON "PaymentEditGrant"("userId", "day");
ALTER TABLE "PaymentEditGrant" ADD CONSTRAINT "PaymentEditGrant_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
