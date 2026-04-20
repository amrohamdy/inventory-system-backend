'use strict';

const prisma = require('../config/database');

const roleIdByCodeCache = new Map();

const normalizeRole = (role = '') => {
    const normalized = String(role).toUpperCase();
    return normalized === 'SECURITY_MANAGER' ? 'SECURITY' : normalized;
};

/** Resolve role code from TenantMember (relation object or legacy string). */
const membershipRoleCode = (m) => {
    if (!m?.role) return null;
    if (typeof m.role === 'object' && m.role !== null && 'code' in m.role) return m.role.code;
    return m.role;
};

/**
 * Load permission codes granted to a role from the database.
 */
const loadPermissionCodesForRoleId = async (roleId) => {
    if (!roleId) return [];
    const rows = await prisma.rolePermission.findMany({
        where: { roleId },
        select: { permission: { select: { code: true } } },
    });
    return rows.map((r) => r.permission.code);
};

const loadAllPermissionCodes = async () => {
    const rows = await prisma.permission.findMany({
        select: { code: true },
    });
    return rows.map((r) => r.code);
};

/**
 * Resolve role UUID by stable code (cached).
 */
const getRoleIdByCode = async (code) => {
    const c = normalizeRole(code);
    if (roleIdByCodeCache.has(c)) return roleIdByCodeCache.get(c);
    const row = await prisma.role.findUnique({ where: { code: c }, select: { id: true } });
    if (row) roleIdByCodeCache.set(c, row.id);
    return row?.id ?? null;
};

/**
 * Permissions for a membership: DB-driven.
 * ORG_MANAGER is intentionally granted all available permissions.
 * SUPER_ADMIN keeps legacy ADMIN-mirror fallback when explicit links are missing.
 */
const getPermissionsForMembership = async ({ roleId, roleCode }) => {
    const rc = normalizeRole(roleCode);
    if (rc === 'ORG_MANAGER') {
        const allCodes = await loadAllPermissionCodes();
        if (allCodes.length > 0) return allCodes;
    }

    const codes = await loadPermissionCodesForRoleId(roleId);
    if (codes.length > 0) return codes;
    if (rc === 'SUPER_ADMIN') {
        const adminId = await getRoleIdByCode('ADMIN');
        if (adminId) return loadPermissionCodesForRoleId(adminId);
    }
    return [];
};

/** Prisma nested connect by stable role code. */
const connectRole = (code) => ({ connect: { code: normalizeRole(code) } });

module.exports = {
    normalizeRole,
    membershipRoleCode,
    loadPermissionCodesForRoleId,
    getRoleIdByCode,
    getPermissionsForMembership,
    connectRole,
};
