-- AlterTable
ALTER TABLE "get_pass_returns" ADD COLUMN "isLost" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "get_pass_returns" ADD COLUMN "isDamaged" BOOLEAN NOT NULL DEFAULT false;
