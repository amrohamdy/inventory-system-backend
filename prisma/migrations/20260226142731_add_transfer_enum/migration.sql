-- AlterEnum
ALTER TYPE "MovementType" ADD VALUE 'TRANSFER';

-- CreateIndex
CREATE INDEX "inventory_ledger_tenantId_locationId_itemId_createdAt_idx" ON "inventory_ledger"("tenantId", "locationId", "itemId", "createdAt");

-- CreateIndex
CREATE INDEX "inventory_ledger_tenantId_referenceId_idx" ON "inventory_ledger"("tenantId", "referenceId");
