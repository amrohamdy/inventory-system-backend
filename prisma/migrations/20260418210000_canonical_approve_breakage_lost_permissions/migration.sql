-- Unify legacy matrix keys (BREAKAGE_APPROVE_REJECT / LOST_APPROVE_REJECT) with JWT/Prisma codes (APPROVE_BREAKAGE / APPROVE_LOST).
-- Merges duplicate permission rows and re-links role_permissions.

-- ── APPROVE_BREAKAGE ─────────────────────────────────────────────────────────
DO $$
DECLARE
  old_id UUID;
  new_id UUID;
BEGIN
  SELECT id INTO old_id FROM "permissions" WHERE code = 'BREAKAGE_APPROVE_REJECT';
  SELECT id INTO new_id FROM "permissions" WHERE code = 'APPROVE_BREAKAGE';

  IF old_id IS NOT NULL AND new_id IS NOT NULL AND old_id <> new_id THEN
    INSERT INTO "role_permissions" ("roleId", "permissionId")
    SELECT rp."roleId", new_id
    FROM "role_permissions" rp
    WHERE rp."permissionId" = old_id
    ON CONFLICT DO NOTHING;
    DELETE FROM "role_permissions" WHERE "permissionId" = old_id;
    DELETE FROM "permissions" WHERE id = old_id;
  ELSIF old_id IS NOT NULL AND new_id IS NULL THEN
    UPDATE "permissions"
    SET
      code = 'APPROVE_BREAKAGE',
      name = COALESCE(NULLIF(TRIM(name), ''), 'Approve or reject breakage workflow steps'),
      "updatedAt" = NOW()
    WHERE id = old_id;
  END IF;
END $$;

-- ── APPROVE_LOST ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  old_id UUID;
  new_id UUID;
BEGIN
  SELECT id INTO old_id FROM "permissions" WHERE code = 'LOST_APPROVE_REJECT';
  SELECT id INTO new_id FROM "permissions" WHERE code = 'APPROVE_LOST';

  IF old_id IS NOT NULL AND new_id IS NOT NULL AND old_id <> new_id THEN
    INSERT INTO "role_permissions" ("roleId", "permissionId")
    SELECT rp."roleId", new_id
    FROM "role_permissions" rp
    WHERE rp."permissionId" = old_id
    ON CONFLICT DO NOTHING;
    DELETE FROM "role_permissions" WHERE "permissionId" = old_id;
    DELETE FROM "permissions" WHERE id = old_id;
  ELSIF old_id IS NOT NULL AND new_id IS NULL THEN
    UPDATE "permissions"
    SET
      code = 'APPROVE_LOST',
      name = COALESCE(NULLIF(TRIM(name), ''), 'Approve or reject lost item workflow steps'),
      "updatedAt" = NOW()
    WHERE id = old_id;
  END IF;
END $$;

-- Ensure rows exist (idempotent) and tenant approver roles are linked (matches 20260418180000_breakage_lost_role_permissions).
INSERT INTO "permissions" ("id", "code", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid(), v.code, v.name, NOW(), NOW()
FROM (VALUES
  ('APPROVE_BREAKAGE', 'Approve or reject breakage workflow steps'),
  ('APPROVE_LOST', 'Approve or reject lost item workflow steps')
) AS v(code, name)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "roles" r
INNER JOIN "permissions" p ON p.code IN ('APPROVE_BREAKAGE', 'APPROVE_LOST')
WHERE r.code IN ('COST_CONTROL', 'FINANCE_MANAGER', 'GENERAL_MANAGER', 'ADMIN', 'ORG_MANAGER')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
