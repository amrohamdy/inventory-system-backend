-- Denormalized license fields on tenants (matches schema.prisma Tenant model)

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "planType" "PlanType" NOT NULL DEFAULT 'BASIC';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "subStatus" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "licenseStartDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "licenseEndDate" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "maxUsers" INTEGER NOT NULL DEFAULT 10;
