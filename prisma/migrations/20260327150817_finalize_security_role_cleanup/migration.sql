-- Finalize SECURITY role cleanup by removing SECURITY_MANAGER from the enum.
-- Postgres enums cannot drop values, so we create a new enum type and swap columns.

-- 1) Ensure any remaining legacy values are migrated.
UPDATE "tenant_members"
SET "role" = 'SECURITY'
WHERE "role" = 'SECURITY_MANAGER';

UPDATE "approval_steps"
SET "requiredRole" = 'SECURITY'
WHERE "requiredRole" = 'SECURITY_MANAGER';

-- 2) Create a new enum without SECURITY_MANAGER.
CREATE TYPE "UserRole_new" AS ENUM (
  'SUPER_ADMIN',
  'ADMIN',
  'ORG_MANAGER',
  'STOREKEEPER',
  'DEPT_MANAGER',
  'COST_CONTROL',
  'FINANCE_MANAGER',
  'AUDITOR',
  'SECURITY'
);

-- 3) Swap the affected columns to the new enum type.
ALTER TABLE "tenant_members"
  ALTER COLUMN "role" TYPE "UserRole_new"
  USING ("role"::text::"UserRole_new");

ALTER TABLE "approval_steps"
  ALTER COLUMN "requiredRole" TYPE "UserRole_new"
  USING ("requiredRole"::text::"UserRole_new");

-- 4) Replace the old enum type.
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "UserRole_old";

