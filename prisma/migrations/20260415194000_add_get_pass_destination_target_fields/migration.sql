-- AlterTable
ALTER TABLE "get_passes"
ADD COLUMN "destinationDepartmentId" UUID,
ADD COLUMN "destinationLocationId" UUID;

-- CreateIndex
CREATE INDEX "get_passes_destinationDepartmentId_idx" ON "get_passes"("destinationDepartmentId");

-- CreateIndex
CREATE INDEX "get_passes_destinationLocationId_idx" ON "get_passes"("destinationLocationId");
