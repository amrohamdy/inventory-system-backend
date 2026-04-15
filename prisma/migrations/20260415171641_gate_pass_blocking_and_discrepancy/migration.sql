-- AlterEnum
ALTER TYPE "GetPassType" ADD VALUE 'OUTSIDE_CATERING';

-- AlterTable
ALTER TABLE "get_pass_lines" ADD COLUMN     "discrepancyReason" TEXT,
ADD COLUMN     "qtyDiscrepancyAtDestination" DECIMAL(15,4) NOT NULL DEFAULT 0,
ADD COLUMN     "qtyReceivedAtDestination" DECIMAL(15,4) NOT NULL DEFAULT 0,
ADD COLUMN     "receivedCondition" TEXT;

-- AlterTable
ALTER TABLE "stock_balances" ADD COLUMN     "qtyBlocked" DECIMAL(15,4) NOT NULL DEFAULT 0;
