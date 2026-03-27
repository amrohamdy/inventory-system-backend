-- Hotfix: ensure tenant_members exists even if previous migration was marked applied
-- while still containing the old SQL content.

-- 1) Create tenant_members table if missing
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

-- 2) Backfill memberships only when legacy users.role column is still present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'role'
  ) THEN
    INSERT INTO "tenant_members" ("tenantId", "userId", "role", "isActive", "createdAt", "updatedAt")
    SELECT CASE WHEN u."role" = 'SUPER_ADMIN' THEN NULL ELSE u."tenantId" END,
           u."id",
           u."role",
           true,
           COALESCE(u."createdAt", CURRENT_TIMESTAMP),
           CURRENT_TIMESTAMP
    FROM "users" u
    LEFT JOIN "tenant_members" tm
      ON tm."tenantId" IS NOT DISTINCT FROM CASE WHEN u."role" = 'SUPER_ADMIN' THEN NULL ELSE u."tenantId" END
     AND tm."userId" = u."id"
    WHERE u."role" IS NOT NULL
      AND tm."id" IS NULL;
  END IF;
END $$;

-- 3) Enforce global users.email uniqueness when legacy schema exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'role'
  ) THEN
    IF EXISTS (
      SELECT lower("email")
      FROM "users"
      GROUP BY lower("email")
      HAVING COUNT(*) > 1
    ) THEN
      RAISE EXCEPTION 'Cannot apply global unique users.email: duplicate emails exist across tenants.';
    END IF;
  END IF;
END $$;

DROP INDEX IF EXISTS "users_tenantId_email_key";
DROP INDEX IF EXISTS "users_tenantId_idx";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_email_key'
  ) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_email_key" UNIQUE ("email");
  END IF;
END $$;

ALTER TABLE "users" DROP COLUMN IF EXISTS "tenantId";
ALTER TABLE "users" DROP COLUMN IF EXISTS "role";
