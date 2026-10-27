-- SIM cards are handed to a salesperson as an ICCID range (first and last),
-- recorded on the request line, instead of each card's ICCID at the sale.
ALTER TABLE "StockRequestItem" ADD COLUMN "iccidFrom" TEXT, ADD COLUMN "iccidTo" TEXT;
