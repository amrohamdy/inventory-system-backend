-- Backfill existing records from SECURITY_MANAGER to SECURITY
UPDATE "tenant_members"
SET "role" = 'SECURITY'
WHERE "role" = 'SECURITY_MANAGER';

