-- Migration: add Security Manager role + Get Pass approval workflow
-- Date: 20260315220000
-- AssetLoan* steps run only if that feature exists in the DB (enum/table may be absent on older schemas).

-- 1. Add SECURITY_MANAGER to UserRole enum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SECURITY_MANAGER';

-- 2. Extend AssetLoanStatus only when the enum exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AssetLoanStatus') THEN
    ALTER TYPE "AssetLoanStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
    ALTER TYPE "AssetLoanStatus" ADD VALUE IF NOT EXISTS 'PENDING_SECURITY_EXIT';
    ALTER TYPE "AssetLoanStatus" ADD VALUE IF NOT EXISTS 'APPROVED_EXIT';
    ALTER TYPE "AssetLoanStatus" ADD VALUE IF NOT EXISTS 'PENDING_SECURITY_RETURN';
  END IF;
END $$;

-- 3. Add approval columns only when asset_loans exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'asset_loans'
  ) THEN
    ALTER TABLE "asset_loans"
      ADD COLUMN IF NOT EXISTS "exitApprovedBy"      UUID,
      ADD COLUMN IF NOT EXISTS "exitApprovedAt"      TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS "exitNotes"           TEXT,
      ADD COLUMN IF NOT EXISTS "returnQty"           DECIMAL(15,4),
      ADD COLUMN IF NOT EXISTS "returnCondition"     TEXT,
      ADD COLUMN IF NOT EXISTS "returnNotes"         TEXT,
      ADD COLUMN IF NOT EXISTS "returnRegisteredBy"  UUID,
      ADD COLUMN IF NOT EXISTS "returnRegisteredAt"  TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS "returnApprovedBy"    UUID,
      ADD COLUMN IF NOT EXISTS "returnApprovedAt"    TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS "returnApprovalNotes" TEXT;
  END IF;
END $$;

-- 4. Foreign keys only when asset_loans exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'asset_loans'
  ) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'asset_loans_exitApprovedBy_fkey'
  ) THEN
    ALTER TABLE "asset_loans"
      ADD CONSTRAINT "asset_loans_exitApprovedBy_fkey"
      FOREIGN KEY ("exitApprovedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'asset_loans_returnRegisteredBy_fkey'
  ) THEN
    ALTER TABLE "asset_loans"
      ADD CONSTRAINT "asset_loans_returnRegisteredBy_fkey"
      FOREIGN KEY ("returnRegisteredBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'asset_loans_returnApprovedBy_fkey'
  ) THEN
    ALTER TABLE "asset_loans"
      ADD CONSTRAINT "asset_loans_returnApprovedBy_fkey"
      FOREIGN KEY ("returnApprovedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
