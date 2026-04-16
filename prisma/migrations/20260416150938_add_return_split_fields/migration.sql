-- AlterTable
ALTER TABLE "get_pass_lines" ADD COLUMN     "damagePhotos" JSONB,
ADD COLUMN     "returnedDamagedQty" DECIMAL(15,4) NOT NULL DEFAULT 0,
ADD COLUMN     "returnedGoodQty" DECIMAL(15,4) NOT NULL DEFAULT 0,
ADD COLUMN     "returnedLostQty" DECIMAL(15,4) NOT NULL DEFAULT 0;
