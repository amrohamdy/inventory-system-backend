-- CreateEnum
CREATE TYPE "MovementSourceType" AS ENUM ('INTERNAL', 'GET_PASS_RETURN');

-- AlterTable
ALTER TABLE "movement_documents" ADD COLUMN     "getPassId" UUID,
ADD COLUMN     "sourceType" "MovementSourceType" NOT NULL DEFAULT 'INTERNAL';

-- CreateIndex
CREATE INDEX "movement_documents_tenantId_sourceType_idx" ON "movement_documents"("tenantId", "sourceType");

-- CreateIndex
CREATE INDEX "movement_documents_tenantId_getPassId_idx" ON "movement_documents"("tenantId", "getPassId");

-- AddForeignKey
ALTER TABLE "movement_documents" ADD CONSTRAINT "movement_documents_getPassId_fkey" FOREIGN KEY ("getPassId") REFERENCES "get_passes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
