-- CreateEnum
CREATE TYPE "GetPassReturnType" AS ENUM ('DAMAGED', 'LOST');

-- CreateEnum
CREATE TYPE "GetPassReturnAccountability" AS ENUM ('EMPLOYEE_DEDUCTION', 'COMPANY_LOSS', 'TARGET_HOTEL_COMPENSATION');

-- AlterTable
ALTER TABLE "get_pass_returns" ADD COLUMN     "accountability" "GetPassReturnAccountability",
ADD COLUMN     "type" "GetPassReturnType";
