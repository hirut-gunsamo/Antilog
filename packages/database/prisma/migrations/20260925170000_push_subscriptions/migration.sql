-- One row per phone that has allowed notifications for a signed-in user.
-- The server checks each user's to-do count every minute and pushes to these
-- when it goes up, so an Owner or supervisor hears about new work with the
-- app closed.
--
-- Hand-written like every migration here: guards exist on this database that
-- do not appear in schema.prisma.

CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'en',
    "lastCount" INTEGER NOT NULL DEFAULT 0,
    "lastLatestAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

ALTER TABLE "PushSubscription"
    ADD CONSTRAINT "PushSubscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
