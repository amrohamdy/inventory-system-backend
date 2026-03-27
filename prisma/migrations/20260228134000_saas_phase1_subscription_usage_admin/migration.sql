-- SaaS Phase 1: Subscription, TenantUsage, SuperAdminLog + new enums

-- 1. Add SUPER_ADMIN to UserRole enum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN' BEFORE 'ADMIN';

-- 2. Create PlanType enum
DO $$ BEGIN
    CREATE TYPE "PlanType" AS ENUM ('BASIC', 'PRO', 'ENTERPRISE', 'CUSTOM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Create SubscriptionStatus enum
DO $$ BEGIN
    CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIAL', 'EXPIRED', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. Create subscriptions table
CREATE TABLE IF NOT EXISTS "subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "planType" "PlanType" NOT NULL DEFAULT 'BASIC',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "maxUsers" INTEGER NOT NULL DEFAULT 5,
    "maxStores" INTEGER NOT NULL DEFAULT 2,
    "maxDepartments" INTEGER NOT NULL DEFAULT 3,
    "maxMonthlyMovements" INTEGER NOT NULL DEFAULT 500,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- 5. Create tenant_usage table
CREATE TABLE IF NOT EXISTS "tenant_usage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "totalUsers" INTEGER NOT NULL DEFAULT 0,
    "totalActiveStores" INTEGER NOT NULL DEFAULT 0,
    "movementsThisMonth" INTEGER NOT NULL DEFAULT 0,
    "movementsResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "storageBytes" BIGINT NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_usage_pkey" PRIMARY KEY ("id")
);

-- 6. Create super_admin_logs table
CREATE TABLE IF NOT EXISTS "super_admin_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "adminUserId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "targetTenantId" UUID,
    "details" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "super_admin_logs_pkey" PRIMARY KEY ("id")
);

-- 7. Unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_tenantId_key" ON "subscriptions"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_usage_tenantId_key" ON "tenant_usage"("tenantId");

-- 8. Indexes for SuperAdminLog
CREATE INDEX IF NOT EXISTS "super_admin_logs_adminUserId_idx" ON "super_admin_logs"("adminUserId");
CREATE INDEX IF NOT EXISTS "super_admin_logs_targetTenantId_idx" ON "super_admin_logs"("targetTenantId");
CREATE INDEX IF NOT EXISTS "super_admin_logs_createdAt_idx" ON "super_admin_logs"("createdAt");

-- 9. Foreign keys
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tenant_usage" ADD CONSTRAINT "tenant_usage_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "super_admin_logs" ADD CONSTRAINT "super_admin_logs_adminUserId_fkey"
    FOREIGN KEY ("adminUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 10. Seed subscription + usage for existing tenants that don't have one yet
INSERT INTO "subscriptions" ("id", "tenantId", "planType", "status", "maxUsers", "maxStores", "maxDepartments", "maxMonthlyMovements", "startDate", "createdAt", "updatedAt")
SELECT gen_random_uuid(), t."id", 'ENTERPRISE', 'ACTIVE', 99999, 99999, 99999, 999999, NOW(), NOW(), NOW()
FROM "tenants" t
WHERE NOT EXISTS (SELECT 1 FROM "subscriptions" s WHERE s."tenantId" = t."id");

INSERT INTO "tenant_usage" ("id", "tenantId", "totalUsers", "totalActiveStores", "movementsThisMonth", "movementsResetAt", "updatedAt")
SELECT gen_random_uuid(), t."id",
    (SELECT COUNT(*) FROM "users" u WHERE u."tenantId" = t."id" AND u."isActive" = true),
    (SELECT COUNT(*) FROM "locations" l WHERE l."tenantId" = t."id" AND l."isActive" = true),
    0, NOW(), NOW()
FROM "tenants" t
WHERE NOT EXISTS (SELECT 1 FROM "tenant_usage" u WHERE u."tenantId" = t."id");
