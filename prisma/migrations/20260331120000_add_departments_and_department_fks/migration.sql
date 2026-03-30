-- Departments table + departmentId FKs (schema had these; migration history was incomplete)

CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "departments_tenantId_name_key" ON "departments"("tenantId", "name");
CREATE UNIQUE INDEX "departments_tenantId_code_key" ON "departments"("tenantId", "code");
CREATE INDEX "departments_tenantId_idx" ON "departments"("tenantId");

ALTER TABLE "departments" ADD CONSTRAINT "departments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- locations.departmentId
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "departmentId" UUID;

CREATE INDEX IF NOT EXISTS "locations_departmentId_idx" ON "locations"("departmentId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'locations_departmentId_fkey') THEN
    ALTER TABLE "locations"
      ADD CONSTRAINT "locations_departmentId_fkey"
      FOREIGN KEY ("departmentId") REFERENCES "departments"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- categories.departmentId
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "departmentId" UUID;

CREATE INDEX IF NOT EXISTS "categories_departmentId_idx" ON "categories"("departmentId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_departmentId_fkey') THEN
    ALTER TABLE "categories"
      ADD CONSTRAINT "categories_departmentId_fkey"
      FOREIGN KEY ("departmentId") REFERENCES "departments"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- items: add departmentId (legacy "department" text column may still exist)
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "departmentId" UUID;

CREATE INDEX IF NOT EXISTS "items_tenantId_departmentId_idx" ON "items"("tenantId", "departmentId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_departmentId_fkey') THEN
    ALTER TABLE "items"
      ADD CONSTRAINT "items_departmentId_fkey"
      FOREIGN KEY ("departmentId") REFERENCES "departments"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- tenant_members.departmentId → departments (column from earlier migration)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_members_departmentId_fkey') THEN
    ALTER TABLE "tenant_members"
      ADD CONSTRAINT "tenant_members_departmentId_fkey"
      FOREIGN KEY ("departmentId") REFERENCES "departments"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- items: columns present in schema but missing from legacy init migration
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "defaultStoreId" UUID;
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "code" TEXT;
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "reorderPoint" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "reorderQty" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "items_defaultStoreId_idx" ON "items"("defaultStoreId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_defaultStoreId_fkey') THEN
    ALTER TABLE "items"
      ADD CONSTRAINT "items_defaultStoreId_fkey"
      FOREIGN KEY ("defaultStoreId") REFERENCES "locations"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "items_tenantId_code_key" ON "items"("tenantId", "code");
