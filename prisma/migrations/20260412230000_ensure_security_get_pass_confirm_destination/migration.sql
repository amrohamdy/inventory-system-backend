-- Ensure SECURITY role has GET_PASS_CONFIRM_DESTINATION (idempotent; fixes DBs seeded before matrix sync).
-- JWT permissions are loaded from role_permissions; Angular gates the confirm-receipt action on this code.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.code = 'SECURITY' AND p.code = 'GET_PASS_CONFIRM_DESTINATION'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
