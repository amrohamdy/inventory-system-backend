-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ORG_MANAGER', 'ADMIN', 'STOREKEEPER', 'DEPT_MANAGER', 'COST_CONTROL', 'FINANCE_MANAGER', 'AUDITOR', 'SECURITY', 'GENERAL_MANAGER');

-- AlterTable: preserve existing text values (must match enum labels)
ALTER TABLE "roles" ALTER COLUMN "code" TYPE "UserRole" USING ("code"::"UserRole");
