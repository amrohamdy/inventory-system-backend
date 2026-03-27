-- Split tenant subscription status from administrative status
-- 1) Add adminStatus to tenants and backfill from legacy subStatus='SUSPENDED'
-- 2) Move tenants.subStatus to TenantSubStatus (TRIAL/ACTIVE/EXPIRED)
-- 3) Narrow SubscriptionStatus enum (used by subscriptions) to TRIAL/ACTIVE/EXPIRED

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TenantAdminStatus') THEN
    CREATE TYPE "TenantAdminStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
  END IF;
END $$;

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TenantSubStatus') THEN
    CREATE TYPE "TenantSubStatus" AS ENUM ('TRIAL', 'ACTIVE', 'EXPIRED');
  END IF;
END $$;

-- Add adminStatus column (default ACTIVE)
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "adminStatus" "TenantAdminStatus" NOT NULL DEFAULT 'ACTIVE';

-- Pre-migration safety: preserve any legacy suspension state
UPDATE "tenants"
SET "adminStatus" = 'SUSPENDED'
WHERE "subStatus" = 'SUSPENDED';

-- Ensure subscriptions don't carry legacy SUSPENDED before narrowing enum
UPDATE "subscriptions"
SET "status" = 'ACTIVE'
WHERE "status" = 'SUSPENDED';

-- Move tenants.subStatus to new enum (TenantSubStatus), mapping legacy SUSPENDED -> ACTIVE
ALTER TABLE "tenants"
  ALTER COLUMN "subStatus" DROP DEFAULT;

ALTER TABLE "tenants"
  ALTER COLUMN "subStatus" TYPE "TenantSubStatus"
  USING (
    CASE "subStatus"::text
      WHEN 'TRIAL' THEN 'TRIAL'::"TenantSubStatus"
      WHEN 'EXPIRED' THEN 'EXPIRED'::"TenantSubStatus"
      ELSE 'ACTIVE'::"TenantSubStatus"
    END
  );

ALTER TABLE "tenants"
  ALTER COLUMN "subStatus" SET DEFAULT 'TRIAL';

-- Narrow SubscriptionStatus enum (used by subscriptions.status)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubscriptionStatus') THEN
    CREATE TYPE "SubscriptionStatus_new" AS ENUM ('ACTIVE', 'TRIAL', 'EXPIRED');

    ALTER TABLE "subscriptions"
      ALTER COLUMN "status" DROP DEFAULT;

    ALTER TABLE "subscriptions"
      ALTER COLUMN "status" TYPE "SubscriptionStatus_new"
      USING ("status"::text::"SubscriptionStatus_new");

    ALTER TABLE "subscriptions"
      ALTER COLUMN "status" SET DEFAULT 'TRIAL';

    DROP TYPE "SubscriptionStatus";
    ALTER TYPE "SubscriptionStatus_new" RENAME TO "SubscriptionStatus";
  END IF;
END $$;

