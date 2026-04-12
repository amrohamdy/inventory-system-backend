-- AlterTable
ALTER TABLE "get_passes" ADD COLUMN     "destinationDeptAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "destinationDeptAcceptedBy" UUID;

-- AddForeignKey
ALTER TABLE "get_passes" ADD CONSTRAINT "get_passes_destinationDeptAcceptedBy_fkey" FOREIGN KEY ("destinationDeptAcceptedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
