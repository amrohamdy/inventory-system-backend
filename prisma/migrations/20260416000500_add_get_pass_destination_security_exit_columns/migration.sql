-- AlterTable
ALTER TABLE "get_passes"
ADD COLUMN "destinationSecurityExitAt" TIMESTAMP(3),
ADD COLUMN "destinationSecurityExitBy" UUID;

-- AddForeignKey
ALTER TABLE "get_passes"
ADD CONSTRAINT "get_passes_destinationSecurityExitBy_fkey"
FOREIGN KEY ("destinationSecurityExitBy")
REFERENCES "users"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
