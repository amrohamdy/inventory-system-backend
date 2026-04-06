/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,abbreviation]` on the table `units` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "location_users" DROP CONSTRAINT "location_users_locationId_fkey";

-- DropForeignKey
ALTER TABLE "location_users" DROP CONSTRAINT "location_users_userId_fkey";

-- CreateIndex
CREATE INDEX "movement_documents_tenantId_supplierId_idx" ON "movement_documents"("tenantId", "supplierId");

-- CreateIndex
CREATE INDEX "movement_lines_unitId_idx" ON "movement_lines"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "units_tenantId_abbreviation_key" ON "units"("tenantId", "abbreviation");

-- AddForeignKey
ALTER TABLE "location_users" ADD CONSTRAINT "location_users_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_users" ADD CONSTRAINT "location_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_documents" ADD CONSTRAINT "movement_documents_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_lines" ADD CONSTRAINT "movement_lines_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
