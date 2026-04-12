-- AlterEnum
ALTER TYPE "GetPassStatus" ADD VALUE 'RECEIVED_AT_DESTINATION';

-- AlterTable
ALTER TABLE "get_passes" ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "receivedById" UUID,
ADD COLUMN     "receivedCondition" TEXT,
ADD COLUMN     "receivedNotes" TEXT;

-- AddForeignKey
ALTER TABLE "get_passes" ADD CONSTRAINT "get_passes_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
