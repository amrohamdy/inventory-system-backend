-- Dynamic RBAC: Role/Permission tables, migrate off UserRole enum, workflow enum extensions.

-- 1) Extend enums (append-only safe for existing rows)
ALTER TYPE "TransferStatus" ADD VALUE 'PENDING_DEPT';
ALTER TYPE "TransferStatus" ADD VALUE 'PENDING_FINANCE';
ALTER TYPE "TransferStatus" ADD VALUE 'PENDING_FINAL';

ALTER TYPE "RequisitionStatus" ADD VALUE 'PENDING_DEPT';
ALTER TYPE "RequisitionStatus" ADD VALUE 'PENDING_FINANCE';
ALTER TYPE "RequisitionStatus" ADD VALUE 'PENDING_FINAL';

ALTER TYPE "ApprovalRequestType" ADD VALUE 'STORE_TRANSFER';

ALTER TYPE "ApprovalStepStatus" ADD VALUE 'CANCELLED';

-- 2) RBAC tables
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tenantId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");
CREATE INDEX "roles_tenantId_idx" ON "roles"("tenantId");
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

CREATE TABLE "role_permissions" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,
    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) Seed system roles
INSERT INTO "roles" ("id", "code", "name", "tenantId", "isActive", "createdAt", "updatedAt") VALUES
  (gen_random_uuid(), 'SUPER_ADMIN', 'Super Admin', NULL, true, NOW(), NOW()),
  (gen_random_uuid(), 'ADMIN', 'Admin', NULL, true, NOW(), NOW()),
  (gen_random_uuid(), 'ORG_MANAGER', 'Organization Manager', NULL, true, NOW(), NOW()),
  (gen_random_uuid(), 'STOREKEEPER', 'Storekeeper', NULL, true, NOW(), NOW()),
  (gen_random_uuid(), 'DEPT_MANAGER', 'Department Manager', NULL, true, NOW(), NOW()),
  (gen_random_uuid(), 'COST_CONTROL', 'Cost Control', NULL, true, NOW(), NOW()),
  (gen_random_uuid(), 'FINANCE_MANAGER', 'Finance Manager', NULL, true, NOW(), NOW()),
  (gen_random_uuid(), 'AUDITOR', 'Auditor', NULL, true, NOW(), NOW()),
  (gen_random_uuid(), 'SECURITY', 'Security', NULL, true, NOW(), NOW());

-- 4) Seed permissions (canonical keys from authorize.js PERMISSIONS)
INSERT INTO "permissions" ("id", "code", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid(), v.code, v.name, NOW(), NOW()
FROM (VALUES
  ('BASIC_DATA_EDIT', 'Basic data edit'),
  ('BASIC_DATA_VIEW', 'Basic data view'),
  ('INVENTORY_VIEW', 'Inventory view'),
  ('MOVEMENT_CREATE', 'Movement create'),
  ('ISSUE_CREATE', 'Issue create'),
  ('ISSUE_APPROVE', 'Issue approve'),
  ('TRANSFER_CREATE', 'Transfer create'),
  ('TRANSFER_APPROVE', 'Transfer approve'),
  ('TRANSFER_DISPATCH_RECEIVE', 'Transfer dispatch receive'),
  ('GRN_VIEW', 'GRN view'),
  ('GRN_MANAGE', 'GRN manage'),
  ('BREAKAGE_CREATE', 'Breakage create'),
  ('ADJUSTMENT_CREATE', 'Adjustment create'),
  ('BREAKAGE_APPROVE_REJECT', 'Breakage approve reject'),
  ('STOCK_COUNT_MANAGE', 'Stock count manage'),
  ('STOCK_COUNT_VIEW', 'Stock count view'),
  ('REPORTS_VIEW', 'Reports view'),
  ('REPORTS_EXPORT', 'Reports export'),
  ('GET_PASS_CREATE', 'Get pass create'),
  ('GET_PASS_VIEW', 'Get pass view'),
  ('GET_PASS_APPROVE', 'Get pass approve'),
  ('GET_PASS_APPROVE_EXIT', 'Get pass approve exit'),
  ('GET_PASS_APPROVE_RETURN', 'Get pass approve return'),
  ('IMPORT_CREATE', 'Import create'),
  ('IMPORT_EXCEL', 'Import excel'),
  ('USERS_COMPANY_MANAGE', 'Users company manage'),
  ('SETTINGS_MANAGE', 'Settings manage'),
  ('AUDIT_LOG_VIEW', 'Audit log view')
) AS v(code, name);

-- 5) Seed role_permissions (matrix from authorize.js)
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE
     (p.code = 'BASIC_DATA_EDIT' AND r.code IN ('ADMIN'))
  OR (p.code = 'BASIC_DATA_VIEW' AND r.code IN ('ADMIN', 'STOREKEEPER', 'DEPT_MANAGER', 'COST_CONTROL', 'FINANCE_MANAGER', 'AUDITOR'))
  OR (p.code = 'INVENTORY_VIEW' AND r.code IN ('ADMIN', 'STOREKEEPER', 'DEPT_MANAGER', 'COST_CONTROL', 'FINANCE_MANAGER', 'AUDITOR'))
  OR (p.code = 'MOVEMENT_CREATE' AND r.code IN ('ADMIN', 'STOREKEEPER'))
  OR (p.code = 'ISSUE_CREATE' AND r.code IN ('ADMIN', 'STOREKEEPER', 'DEPT_MANAGER'))
  OR (p.code = 'ISSUE_APPROVE' AND r.code IN ('ADMIN', 'DEPT_MANAGER', 'COST_CONTROL', 'FINANCE_MANAGER'))
  OR (p.code = 'TRANSFER_CREATE' AND r.code IN ('ADMIN', 'STOREKEEPER'))
  OR (p.code = 'TRANSFER_APPROVE' AND r.code IN ('ADMIN', 'DEPT_MANAGER', 'FINANCE_MANAGER'))
  OR (p.code = 'TRANSFER_DISPATCH_RECEIVE' AND r.code IN ('ADMIN', 'STOREKEEPER'))
  OR (p.code = 'GRN_VIEW' AND r.code IN ('ADMIN', 'STOREKEEPER', 'DEPT_MANAGER', 'COST_CONTROL', 'FINANCE_MANAGER', 'AUDITOR'))
  OR (p.code = 'GRN_MANAGE' AND r.code IN ('ADMIN', 'STOREKEEPER'))
  OR (p.code = 'BREAKAGE_CREATE' AND r.code IN ('ADMIN', 'STOREKEEPER', 'DEPT_MANAGER'))
  OR (p.code = 'ADJUSTMENT_CREATE' AND r.code IN ('ADMIN', 'STOREKEEPER'))
  OR (p.code = 'BREAKAGE_APPROVE_REJECT' AND r.code IN ('ADMIN', 'DEPT_MANAGER', 'COST_CONTROL', 'FINANCE_MANAGER'))
  OR (p.code = 'STOCK_COUNT_MANAGE' AND r.code IN ('ADMIN', 'STOREKEEPER'))
  OR (p.code = 'STOCK_COUNT_VIEW' AND r.code IN ('ADMIN', 'STOREKEEPER', 'COST_CONTROL', 'FINANCE_MANAGER', 'AUDITOR'))
  OR (p.code = 'REPORTS_VIEW' AND r.code IN ('ADMIN', 'STOREKEEPER', 'DEPT_MANAGER', 'COST_CONTROL', 'FINANCE_MANAGER', 'AUDITOR'))
  OR (p.code = 'REPORTS_EXPORT' AND r.code IN ('ADMIN', 'STOREKEEPER', 'COST_CONTROL', 'FINANCE_MANAGER', 'AUDITOR'))
  OR (p.code = 'GET_PASS_CREATE' AND r.code IN ('ADMIN', 'STOREKEEPER'))
  OR (p.code = 'GET_PASS_VIEW' AND r.code IN ('ADMIN', 'STOREKEEPER', 'SECURITY', 'FINANCE_MANAGER', 'AUDITOR'))
  OR (p.code = 'GET_PASS_APPROVE' AND r.code IN ('ADMIN', 'SECURITY'))
  OR (p.code = 'GET_PASS_APPROVE_EXIT' AND r.code IN ('ADMIN', 'SECURITY'))
  OR (p.code = 'GET_PASS_APPROVE_RETURN' AND r.code IN ('ADMIN', 'SECURITY'))
  OR (p.code = 'IMPORT_CREATE' AND r.code IN ('ADMIN', 'STOREKEEPER'))
  OR (p.code = 'IMPORT_EXCEL' AND r.code IN ('ADMIN', 'STOREKEEPER'))
  OR (p.code = 'USERS_COMPANY_MANAGE' AND r.code IN ('ADMIN'))
  OR (p.code = 'SETTINGS_MANAGE' AND r.code IN ('ADMIN'))
  OR (p.code = 'AUDIT_LOG_VIEW' AND r.code IN ('ADMIN', 'FINANCE_MANAGER', 'AUDITOR'));

-- SUPER_ADMIN and ORG_MANAGER inherit ADMIN-equivalent permissions (matches prior authorize.js behavior)
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", rp."permissionId"
FROM "roles" r
CROSS JOIN "role_permissions" rp
INNER JOIN "roles" admin ON admin."id" = rp."roleId" AND admin.code = 'ADMIN'
WHERE r.code IN ('SUPER_ADMIN', 'ORG_MANAGER');

-- 6) tenant_members: add roleId, backfill, drop enum column
ALTER TABLE "tenant_members" ADD COLUMN "roleId" UUID;

UPDATE "tenant_members" AS tm
SET "roleId" = r."id"
FROM "roles" AS r
WHERE r.code = tm.role::text;

ALTER TABLE "tenant_members" ALTER COLUMN "roleId" SET NOT NULL;

DROP INDEX IF EXISTS "tenant_members_tenantId_role_idx";

ALTER TABLE "tenant_members" DROP COLUMN "role";

ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "tenant_members_tenantId_roleId_idx" ON "tenant_members"("tenantId", "roleId");

-- 7) approval_steps: requiredRole -> requiredRoleId
ALTER TABLE "approval_steps" ADD COLUMN "requiredRoleId" UUID;

UPDATE "approval_steps" AS s
SET "requiredRoleId" = r."id"
FROM "roles" AS r
WHERE r.code = s."requiredRole"::text;

ALTER TABLE "approval_steps" ALTER COLUMN "requiredRoleId" SET NOT NULL;

ALTER TABLE "approval_steps" DROP COLUMN "requiredRole";

ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_requiredRoleId_fkey" FOREIGN KEY ("requiredRoleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "approval_steps_requiredRoleId_idx" ON "approval_steps"("requiredRoleId");

-- 8) Drop UserRole enum (no remaining references)
DROP TYPE "UserRole";

-- 9) User permission invalidation version
ALTER TABLE "users" ADD COLUMN "permissionVersion" INTEGER NOT NULL DEFAULT 0;

-- 10) Link approval_requests to store transfers (optional FK)
ALTER TABLE "approval_requests" ADD COLUMN "storeTransferId" UUID;
CREATE UNIQUE INDEX "approval_requests_storeTransferId_key" ON "approval_requests"("storeTransferId");
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_storeTransferId_fkey" FOREIGN KEY ("storeTransferId") REFERENCES "store_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
