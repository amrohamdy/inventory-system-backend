-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MovementType" ADD VALUE 'TEMP_RECEIVE';
ALTER TYPE "MovementType" ADD VALUE 'TEMP_RELEASE';

-- AlterTable
ALTER TABLE "inventory_ledger" ADD COLUMN     "affectsValuation" BOOLEAN NOT NULL DEFAULT true;
