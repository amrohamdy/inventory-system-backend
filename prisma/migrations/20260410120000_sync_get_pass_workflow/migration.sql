-- Replace GetPassStatus: drop PENDING_SECURITY (map to PENDING_GM), add PENDING_COST_CONTROL and PENDING_GM
CREATE TYPE "GetPassStatus_new" AS ENUM (
  'DRAFT',
  'PENDING_DEPT',
  'PENDING_COST_CONTROL',
  'PENDING_FINANCE',
  'PENDING_GM',
  'APPROVED',
  'OUT',
  'PARTIALLY_RETURNED',
  'RETURNED',
  'CLOSED',
  'REJECTED'
);

ALTER TABLE "get_passes" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "get_passes" ALTER COLUMN "status" TYPE "GetPassStatus_new" USING (
  CASE "status"::text
    WHEN 'PENDING_SECURITY' THEN 'PENDING_GM'::"GetPassStatus_new"
    ELSE "status"::text::"GetPassStatus_new"
  END
);
ALTER TABLE "get_passes" ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"GetPassStatus_new";

DROP TYPE "GetPassStatus";
ALTER TYPE "GetPassStatus_new" RENAME TO "GetPassStatus";

ALTER TABLE "get_passes" ADD COLUMN "costControlApprovedBy" UUID;
ALTER TABLE "get_passes" ADD COLUMN "costControlApprovedAt" TIMESTAMP(3);
ALTER TABLE "get_passes" ADD COLUMN "gmApprovedBy" UUID;
ALTER TABLE "get_passes" ADD COLUMN "gmApprovedAt" TIMESTAMP(3);
ALTER TABLE "get_passes" ADD COLUMN "rejectionReason" TEXT;

ALTER TABLE "get_passes" ADD CONSTRAINT "get_passes_costControlApprovedBy_fkey" FOREIGN KEY ("costControlApprovedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "get_passes" ADD CONSTRAINT "get_passes_gmApprovedBy_fkey" FOREIGN KEY ("gmApprovedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
