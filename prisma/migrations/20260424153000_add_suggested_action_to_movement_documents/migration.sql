-- CreateEnum
CREATE TYPE "SuggestedAction" AS ENUM ('EMPLOYEE', 'HOTEL');

-- AlterTable
ALTER TABLE "movement_documents"
ADD COLUMN "suggestedAction" "SuggestedAction",
ADD COLUMN "responsibleEmployeeName" TEXT;

-- CreateIndex
CREATE INDEX "movement_documents_tenantId_suggestedAction_idx"
ON "movement_documents"("tenantId", "suggestedAction");
