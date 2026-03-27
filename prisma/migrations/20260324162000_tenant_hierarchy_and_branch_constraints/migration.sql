-- Tenant hierarchy + branch constraints
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "parentId" UUID;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "hasBranches" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "maxBranches" INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenants_parentId_fkey'
  ) THEN
    ALTER TABLE "tenants"
      ADD CONSTRAINT "tenants_parentId_fkey"
      FOREIGN KEY ("parentId") REFERENCES "tenants"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "tenants_parentId_idx" ON "tenants"("parentId");
CREATE INDEX IF NOT EXISTS "tenants_hasBranches_idx" ON "tenants"("hasBranches");

-- Multi-tenant user memberships
CREATE TABLE IF NOT EXISTS "tenant_members" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NULL,
  "userId" UUID NOT NULL,
  "role" "UserRole" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_members_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenant_members_tenantId_fkey'
  ) THEN
    ALTER TABLE "tenant_members"
      ADD CONSTRAINT "tenant_members_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenant_members_userId_fkey'
  ) THEN
    ALTER TABLE "tenant_members"
      ADD CONSTRAINT "tenant_members_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_members_tenantId_userId_key"
  ON "tenant_members"("tenantId", "userId");
CREATE INDEX IF NOT EXISTS "tenant_members_userId_idx" ON "tenant_members"("userId");
CREATE INDEX IF NOT EXISTS "tenant_members_tenantId_idx" ON "tenant_members"("tenantId");
CREATE INDEX IF NOT EXISTS "tenant_members_tenantId_role_idx" ON "tenant_members"("tenantId", "role");

-- Backfill old role/tenant data into tenant_members.
INSERT INTO "tenant_members" ("tenantId", "userId", "role", "isActive", "createdAt", "updatedAt")
SELECT CASE WHEN u."role" = 'SUPER_ADMIN' THEN NULL ELSE u."tenantId" END, u."id", u."role", true, COALESCE(u."createdAt", CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
FROM "users" u
LEFT JOIN "tenant_members" tm
  ON tm."tenantId" IS NOT DISTINCT FROM CASE WHEN u."role" = 'SUPER_ADMIN' THEN NULL ELSE u."tenantId" END
 AND tm."userId" = u."id"
WHERE u."role" IS NOT NULL
  AND tm."id" IS NULL;

-- Email is now globally unique across all tenants.
DO $$
BEGIN
  IF EXISTS (
    SELECT lower("email")
    FROM "users"
    GROUP BY lower("email")
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot apply global unique users.email: duplicate emails exist across tenants.';
  END IF;
END $$;

DROP INDEX IF EXISTS "users_tenantId_email_key";
DROP INDEX IF EXISTS "users_tenantId_idx";
ALTER TABLE "users" ADD CONSTRAINT "users_email_key" UNIQUE ("email");
ALTER TABLE "users" DROP COLUMN IF EXISTS "tenantId";
ALTER TABLE "users" DROP COLUMN IF EXISTS "role";
