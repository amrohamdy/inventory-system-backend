-- AlterTable
ALTER TABLE "grn_imports" ADD COLUMN "isEditedAfterRejection" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "grn_imports" ADD COLUMN "lastEditedBy" UUID;

-- AddForeignKey
ALTER TABLE "grn_imports" ADD CONSTRAINT "grn_imports_lastEditedBy_fkey" FOREIGN KEY ("lastEditedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
