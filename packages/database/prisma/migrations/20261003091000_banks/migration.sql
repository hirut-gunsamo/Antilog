-- The banks a transfer sale can name. Staff add more from the sale form.
CREATE TABLE "Bank" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 1000,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Bank_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Bank_name_not_blank" CHECK (length(btrim("name")) > 0)
);

CREATE UNIQUE INDEX "Bank_name_key" ON "Bank" (lower("name"));

ALTER TABLE "Bank"
  ADD CONSTRAINT "Bank_createdById_fkey" FOREIGN KEY ("createdById")
  REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "Bank" ("id", "name", "sortOrder") VALUES
  (md5('bank:' || 'Commercial Bank of Ethiopia (CBE)'), 'Commercial Bank of Ethiopia (CBE)', 0),
  (md5('bank:' || 'Awash Bank'), 'Awash Bank', 1),
  (md5('bank:' || 'Dashen Bank'), 'Dashen Bank', 2),
  (md5('bank:' || 'Bank of Abyssinia'), 'Bank of Abyssinia', 3),
  (md5('bank:' || 'Cooperative Bank of Oromia (Coopbank)'), 'Cooperative Bank of Oromia (Coopbank)', 4),
  (md5('bank:' || 'Hibret Bank'), 'Hibret Bank', 5),
  (md5('bank:' || 'Wegagen Bank'), 'Wegagen Bank', 6),
  (md5('bank:' || 'Nib International Bank'), 'Nib International Bank', 7),
  (md5('bank:' || 'Oromia Bank'), 'Oromia Bank', 8),
  (md5('bank:' || 'Zemen Bank'), 'Zemen Bank', 9),
  (md5('bank:' || 'Bunna Bank'), 'Bunna Bank', 10),
  (md5('bank:' || 'Berhan Bank'), 'Berhan Bank', 11),
  (md5('bank:' || 'Abay Bank'), 'Abay Bank', 12),
  (md5('bank:' || 'Lion International Bank'), 'Lion International Bank', 13),
  (md5('bank:' || 'Enat Bank'), 'Enat Bank', 14),
  (md5('bank:' || 'Addis International Bank'), 'Addis International Bank', 15),
  (md5('bank:' || 'Global Bank Ethiopia'), 'Global Bank Ethiopia', 16),
  (md5('bank:' || 'Debub Global Bank'), 'Debub Global Bank', 17),
  (md5('bank:' || 'Amhara Bank'), 'Amhara Bank', 18),
  (md5('bank:' || 'Siinqee Bank'), 'Siinqee Bank', 19),
  (md5('bank:' || 'Sidama Bank'), 'Sidama Bank', 20),
  (md5('bank:' || 'Ahadu Bank'), 'Ahadu Bank', 21),
  (md5('bank:' || 'Tsehay Bank'), 'Tsehay Bank', 22),
  (md5('bank:' || 'Gadaa Bank'), 'Gadaa Bank', 23),
  (md5('bank:' || 'Hijra Bank'), 'Hijra Bank', 24),
  (md5('bank:' || 'ZamZam Bank'), 'ZamZam Bank', 25),
  (md5('bank:' || 'Tsedey Bank'), 'Tsedey Bank', 26),
  (md5('bank:' || 'Shabelle Bank'), 'Shabelle Bank', 27),
  (md5('bank:' || 'Rammis Bank'), 'Rammis Bank', 28),
  (md5('bank:' || 'Goh Betoch Bank'), 'Goh Betoch Bank', 29),
  (md5('bank:' || 'Development Bank of Ethiopia'), 'Development Bank of Ethiopia', 30),
  (md5('bank:' || 'Telebirr'), 'Telebirr', 31),
  (md5('bank:' || 'M-Pesa'), 'M-Pesa', 32);
