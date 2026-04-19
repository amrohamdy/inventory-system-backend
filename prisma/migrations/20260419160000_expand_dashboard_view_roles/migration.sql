-- Expand dashboard access: rename analytics permission and grant to operational roles.
-- Ensure VIEW_DASHBOARD exists for route access (incl. SECURITY).

INSERT INTO "permissions" ("id", "code", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid(), v.code, v.name, NOW(), NOW()
FROM (VALUES
  ('VIEW_DASHBOARD', 'View dashboard home and navigation')
) AS v(code, name)
ON CONFLICT ("code") DO NOTHING;

UPDATE "permissions"
SET "code" = 'DASHBOARD_VIEW',
    "name" = 'View dashboard analytics (role-scoped KPIs and widgets)',
    "updatedAt" = NOW()
WHERE "code" = 'DASHBOARD_ADMIN_VIEW';

-- Route access: dashboard page (VIEW_DASHBOARD)
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "roles" r
INNER JOIN "permissions" p ON p.code = 'VIEW_DASHBOARD'
WHERE r.code IN (
  'ADMIN',
  'ORG_MANAGER',
  'STOREKEEPER',
  'DEPT_MANAGER',
  'COST_CONTROL',
  'FINANCE_MANAGER',
  'AUDITOR',
  'GENERAL_MANAGER',
  'SECURITY'
)
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- Analytics API (DASHBOARD_VIEW) — expanded role set
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "roles" r
INNER JOIN "permissions" p ON p.code = 'DASHBOARD_VIEW'
WHERE r.code IN (
  'ADMIN',
  'ORG_MANAGER',
  'DEPT_MANAGER',
  'COST_CONTROL',
  'FINANCE_MANAGER',
  'GENERAL_MANAGER',
  'SECURITY',
  'STOREKEEPER',
  'AUDITOR'
)
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
