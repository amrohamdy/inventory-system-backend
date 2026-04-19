-- Align DB role_permissions with authorize.js: SECURITY no longer has BREAKAGE_VIEW (gate-only role).
DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" p
WHERE rp."roleId" = r.id
  AND rp."permissionId" = p.id
  AND r.code = 'SECURITY'
  AND p.code = 'BREAKAGE_VIEW';
