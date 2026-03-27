-- Add department linkage to tenant_members for per-tenant user assignment
ALTER TABLE "tenant_members"
  ADD COLUMN IF NOT EXISTS "departmentId" UUID;

DO $$
BEGIN
  -- Guard for shadow DB / legacy installs where "departments" may not exist yet.
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'departments'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'tenant_members_departmentId_fkey'
    ) THEN
      ALTER TABLE "tenant_members"
        ADD CONSTRAINT "tenant_members_departmentId_fkey"
        FOREIGN KEY ("departmentId") REFERENCES "departments"("id")
        ON DELETE SET NULL
        ON UPDATE CASCADE;
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "tenant_members_departmentId_idx"
  ON "tenant_members"("departmentId");
CREATE INDEX IF NOT EXISTS "tenant_members_tenantId_departmentId_idx"
  ON "tenant_members"("tenantId", "departmentId");
