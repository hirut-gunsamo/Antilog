-- Wereket and Ibid are the same airtime, so the seeded Wereket type goes.
-- Anything filed under it moves to Ibid first, so no product loses its type.
-- Safe where Wereket was already deleted by hand: every statement matches
-- nothing then.

UPDATE "Product"     SET "typeId"   = 'pt_av_ibid' WHERE "typeId"   = 'pt_av_wereket';
UPDATE "ProductType" SET "parentId" = 'pt_av_ibid' WHERE "parentId" = 'pt_av_wereket';
DELETE FROM "ProductType" WHERE "id" = 'pt_av_wereket';
