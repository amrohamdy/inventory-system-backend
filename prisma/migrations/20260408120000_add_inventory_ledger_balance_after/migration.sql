-- Add persisted post-transaction balance for each ledger row
ALTER TABLE "inventory_ledger"
ADD COLUMN "balanceAfter" DECIMAL(15,4) NOT NULL DEFAULT 0;
