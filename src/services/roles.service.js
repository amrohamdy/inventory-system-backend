'use strict';

const prisma = require('../config/database');

/**
 * Roles assignable in a tenant context (global system roles + tenant-specific copies).
 * Excludes SUPER_ADMIN from the hotel-admin UI dropdown.
 */
const listAssignableRoles = async (tenantId) => {
    const rows = await prisma.role.findMany({
        where: {
            isActive: true,
            code: { not: 'SUPER_ADMIN' },
            OR: [{ tenantId: null }, ...(tenantId ? [{ tenantId }] : [])],
        },
        select: {
            id: true,
            code: true,
            name: true,
        },
        orderBy: [{ name: 'asc' }],
    });

    return rows;
};

module.exports = {
    listAssignableRoles,
};
