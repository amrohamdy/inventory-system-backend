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

module.exports = {
    notifyTenantAdmins,
    notifyIncomingInternalGetPass,
};
