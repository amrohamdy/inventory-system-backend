const { UserRole } = require('@prisma/client');

/**
 * Notify all active ADMIN members of a tenant (e.g. incoming internal Get Pass).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
const notifyTenantAdmins = async (tx, tenantId, { type, title, body, payload }) => {
    const admins = await tx.tenantMember.findMany({
        where: {
            tenantId,
            isActive: true,
            role: { code: UserRole.ADMIN },
        },
        select: { userId: true },
    });
    if (admins.length === 0) return;

    await tx.systemNotification.createMany({
        data: admins.map((m) => ({
            tenantId,
            userId: m.userId,
            type,
            title,
            body: body ?? null,
            payload: payload ?? null,
        })),
    });
};

/**
 * Notify active members of one or more role codes in a tenant.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
const notifyTenantRoles = async (tx, tenantId, roles, { type, title, body, payload }) => {
    const normalizedRoles = Array.isArray(roles) ? roles : [roles];
    const members = await tx.tenantMember.findMany({
        where: {
            tenantId,
            isActive: true,
            role: { code: { in: normalizedRoles } },
        },
        select: { userId: true },
    });
    if (members.length === 0) return;

    await tx.systemNotification.createMany({
        data: members.map((m) => ({
            tenantId,
            userId: m.userId,
            type,
            title,
            body: body ?? null,
            payload: payload ?? null,
        })),
    });
};

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
const notifyIncomingInternalGetPass = async (tx, { targetTenantId, getPassId, passNo, sourceTenantName }) => {
    await notifyTenantAdmins(tx, targetTenantId, {
        type: 'GET_PASS_INCOMING_INTERNAL',
        title: 'Incoming internal gate pass',
        body: `${sourceTenantName} created internal gate pass ${passNo} for your hotel.`,
        payload: { getPassId, passNo, sourceTenantName },
    });
};

/**
 * Notify source hotel admins that a permanent internal transfer was received at the destination.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
const notifySourceTenantAdminsOfPermanentReceipt = async (tx, sourceTenantId, { getPassId, passNo, targetTenantName }) => {
    await notifyTenantAdmins(tx, sourceTenantId, {
        type: 'GET_PASS_RECEIVED_AT_DESTINATION',
        title: 'Internal gate pass received',
        body: `${targetTenantName || 'Destination hotel'} confirmed receipt of permanent transfer ${passNo}.`,
        payload: { getPassId, passNo, targetTenantName },
    });
};

module.exports = {
    notifyTenantAdmins,
    notifyTenantRoles,
    notifyIncomingInternalGetPass,
    notifySourceTenantAdminsOfPermanentReceipt,
};
