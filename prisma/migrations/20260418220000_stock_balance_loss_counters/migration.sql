-- Cumulative finalized exits (breakage / lost) per item-location, for reporting and stock balances UI.
ALTER TABLE "stock_balances" ADD COLUMN "totalQtyLost" DECIMAL(15,4) NOT NULL DEFAULT 0;
ALTER TABLE "stock_balances" ADD COLUMN "totalQtyDamage" DECIMAL(15,4) NOT NULL DEFAULT 0;
