-- JWT permissions are loaded from role_permissions (see rbac.service getPermissionsForMembership).
-- Friendly codes for Angular sidebar + approval flows for tenant-wide approvers.
INSERT INTO "permissions" ("id", "code", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid(), v.code, v.name, NOW(), NOW()
FROM (VALUES
  ('READ_BREAKAGE', 'View breakage documents (tenant)'),
  ('APPROVE_BREAKAGE', 'Approve or reject breakage workflow steps'),
  ('READ_LOST', 'View lost item documents (tenant)'),
  ('APPROVE_LOST', 'Approve or reject lost item workflow steps')
) AS v(code, name)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "roles" r
INNER JOIN "permissions" p ON p.code IN ('READ_BREAKAGE', 'APPROVE_BREAKAGE', 'READ_LOST', 'APPROVE_LOST')
WHERE r.code IN ('COST_CONTROL', 'FINANCE_MANAGER', 'GENERAL_MANAGER', 'ADMIN', 'ORG_MANAGER')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
