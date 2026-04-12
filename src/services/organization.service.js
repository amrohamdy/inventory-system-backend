const prisma = require('../config/database');

/**
 * Root organization id for hierarchy: parent tenant id, or self when this tenant is the org root.
 * @param {{ parentId: string | null, id: string }} tenant
 */
const organizationRootId = (tenant) => tenant.parentId ?? tenant.id;

/**
 * Other hotels (tenants) under the same organization as `currentTenantId`.
 * - On an org root: returns active child hotels (branches).
 * - On a branch hotel: returns sibling hotels (same parent), excluding the current tenant.
 */
const getSisterHotels = async (currentTenantId) => {
    const tenant = await prisma.tenant.findUnique({
        where: { id: currentTenantId },
        select: { id: true, parentId: true, isActive: true },
    });
    if (!tenant) {
        const err = new Error('Tenant not found.');
        err.statusCode = 404;
        throw err;
    }

    // Org root: sister hotels are direct child branches.
    if (tenant.parentId == null) {
        return prisma.tenant.findMany({
            where: { parentId: tenant.id, isActive: true },
            select: {
                id: true,
                name: true,
                slug: true,
                email: true,
                phone: true,
                address: true,
            },
            orderBy: { name: 'asc' },
        });
    }

    // Branch hotel: siblings share the same parent organization (same parentId), excluding self.
    const siblingGroupParentId = tenant.parentId;
    return prisma.tenant.findMany({
        where: {
            parentId: siblingGroupParentId,
            id: { not: currentTenantId },
            isActive: true,
        },
        select: {
            id: true,
            name: true,
            slug: true,
            email: true,
            phone: true,
            address: true,
        },
        orderBy: { name: 'asc' },
    });
};

module.exports = {
    getSisterHotels,
    organizationRootId,
};
