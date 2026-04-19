-- Analytics dashboard (Control Tower): JWT permission for executive summary + charts APIs.
INSERT INTO "permissions" ("id", "code", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid(), v.code, v.name, NOW(), NOW()
FROM (VALUES
  ('DASHBOARD_ADMIN_VIEW', 'View analytics dashboard (KPIs, breakage/lost, workflow health)')
) AS v(code, name)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "roles" r
INNER JOIN "permissions" p ON p.code = 'DASHBOARD_ADMIN_VIEW'
WHERE r.code IN ('ADMIN', 'ORG_MANAGER')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
