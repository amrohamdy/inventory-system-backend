const ORG_MANAGER_ASSIGNMENT_ERROR_MESSAGE =
    "This user is an Organization Manager and cannot be assigned to entities outside their organization's hierarchy.";

/**
 * Enforces that if a user is an ORG_MANAGER of any top-level organization,
 * they can only be assigned to:
 * - that same organization tenant, OR
 * - a direct child (branch) whose parentId is that organization.
 *
 * If they are an ORG_MANAGER for multiple organizations, assignment is allowed
 * if the target tenant belongs to any of those organizations' hierarchies.
 */
const assertOrgManagerAssignmentWithinOrgHierarchy = async (db, { userId, targetTenantId }) => {
    if (!userId || !targetTenantId) return;

    const orgManagerOrgMemberships = await db.tenantMember.findMany({
        where: {
            userId,
            role: 'ORG_MANAGER',
            isActive: true,
            tenantId: { not: null },
            tenant: { is: { parentId: null, isActive: true } },
        },
        select: { tenantId: true },
        distinct: ['tenantId'],
    });

    const orgIds = orgManagerOrgMemberships.map((m) => m.tenantId).filter(Boolean);
    if (orgIds.length === 0) return;

    const targetTenant = await db.tenant.findUnique({
        where: { id: targetTenantId },
        select: { id: true, parentId: true },
    });

    // If tenant doesn't exist, let the caller's "Tenant not found" logic handle it.
    if (!targetTenant) return;

    const allowed =
        orgIds.includes(targetTenant.id) ||
        (targetTenant.parentId && orgIds.includes(targetTenant.parentId));

    if (!allowed) {
        throw Object.assign(new Error(ORG_MANAGER_ASSIGNMENT_ERROR_MESSAGE), { statusCode: 403 });
    }
};

module.exports = {
    ORG_MANAGER_ASSIGNMENT_ERROR_MESSAGE,
    assertOrgManagerAssignmentWithinOrgHierarchy,
};
