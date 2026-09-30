-- A contact number for every user.
--
-- Additive only. No column is dropped and no row is deleted.
--
-- Nullable, because the users that already exist have no number on file and
-- deactivating them to add one would be worse than leaving it blank. New users
-- are required to provide one by the API's create schema, so the gap closes
-- naturally rather than by a backfill that would be inventing data.
ALTER TABLE "User" ADD COLUMN "phone" TEXT;
