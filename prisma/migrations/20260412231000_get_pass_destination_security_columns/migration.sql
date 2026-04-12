-- AlterTable
ALTER TABLE "get_passes" ADD COLUMN     "destinationSecurityApprovedAt" TIMESTAMP(3),
ADD COLUMN     "destinationSecurityApprovedBy" UUID;

-- AddForeignKey
ALTER TABLE "get_passes" ADD CONSTRAINT "get_passes_destinationSecurityApprovedBy_fkey" FOREIGN KEY ("destinationSecurityApprovedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
