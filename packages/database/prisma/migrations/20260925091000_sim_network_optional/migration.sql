-- Ethio Telecom is the only network the business sells, so the product form
-- stopped asking. The column stays for the rows that already carry a value.

ALTER TABLE "SimProduct" ALTER COLUMN "network" DROP NOT NULL;
