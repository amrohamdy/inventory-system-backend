/**
 * Plan limits and UI "active users" use the same rule as listUsers:
 * membership is active AND the user account is active.
 */

const whereTenantActiveSeat = (tenantId) => ({
    tenantId,
    isActive: true,
    user: { isActive: true },
});

const countActiveSeats = (db, tenantId) =>
    db.tenantMember.count({ where: whereTenantActiveSeat(tenantId) });

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {string[]} tenantIds
 * @returns {Promise<Map<string, number>>}
 */
const activeSeatCountsByTenantIds = async (db, tenantIds) => {
    const uniqueIds = [...new Set(tenantIds.filter(Boolean))];
    if (uniqueIds.length === 0) return new Map();

    const rows = await db.tenantMember.groupBy({
        by: ['tenantId'],
        where: {
            tenantId: { in: uniqueIds },
            isActive: true,
            user: { isActive: true },
        },
        _count: { _all: true },
    });

    return new Map(rows.map((row) => [row.tenantId, row._count._all]));
};

/**
 * Roles that may have multiple active members in one hotel (tenant).
 * ORG_MANAGER: inherited org managers on branches.
 * STOREKEEPER / DEPT_MANAGER: operational staffing.
 */
const ROLES_ALLOWING_MULTIPLE_ACTIVE_IN_TENANT = new Set([
    'ORG_MANAGER',
    'STOREKEEPER',
    'DEPT_MANAGER',
]);

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 */
const assertSingletonRoleAvailable = async (db, { tenantId, role, excludeUserId }) => {
    if (ROLES_ALLOWING_MULTIPLE_ACTIVE_IN_TENANT.has(role)) return;

    const existing = await db.tenantMember.findFirst({
        where: {
            tenantId,
            role: { code: role },
            isActive: true,
            user: { isActive: true },
            ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
        },
        select: { userId: true },
    });

    if (existing) {
        throw Object.assign(
            new Error('This role is already assigned to another active user in this hotel.'),
            { statusCode: 400 }
        );
    }
};

module.exports = {
    whereTenantActiveSeat,
    countActiveSeats,
    activeSeatCountsByTenantIds,
    assertSingletonRoleAvailable,
    ROLES_ALLOWING_MULTIPLE_ACTIVE_IN_TENANT,
};
