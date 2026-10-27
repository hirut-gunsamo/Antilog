-- Editing a sale: allowed on its own day, later only when the Owner allows it.
ALTER TABLE "Sale" ADD COLUMN "editAllowedUntil" TIMESTAMP(3);
ALTER TABLE "Sale" ADD COLUMN "editedAt" TIMESTAMP(3);
