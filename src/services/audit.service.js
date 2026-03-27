const prisma = require('../config/database');
const logger = require('../utils/logger');

/**
 * M14 — Audit Service
 * Writes immutable audit log entries — never updates or deletes records
 */

const log = async ({ tenantId, entityType, entityId, action, changedBy, beforeValue, afterValue, ipAddress, userAgent }) => {
    try {
        await prisma.auditLog.create({
            data: {
                tenantId,
                entityType,
                entityId: String(entityId),
                action,
                changedBy,
                beforeValue: beforeValue ? JSON.parse(JSON.stringify(beforeValue)) : undefined,
                afterValue: afterValue ? JSON.parse(JSON.stringify(afterValue)) : undefined,
                ipAddress,
                userAgent,
            },
        });
    } catch (err) {
        // Audit logging must never crash the main request
        logger.error(`Audit log write failed: ${err.message}`, { tenantId, entityType, entityId, action });
    }
};

const getAuditLog = async (tenantId, { entityType, entityId, changedBy, from, to, page = 1, limit = 50 } = {}) => {
    const skip = (page - 1) * limit;

    const where = {
        tenantId,
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId: String(entityId) } : {}),
        ...(changedBy ? { changedBy } : {}),
        ...(from || to
            ? {
                changedAt: {
                    ...(from ? { gte: new Date(from) } : {}),
                    ...(to ? { lte: new Date(to) } : {}),
                },
            }
            : {}),
    };

    const [total, logs] = await Promise.all([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({
            where,
            orderBy: { changedAt: 'desc' },
            skip,
            take: limit,
            include: {
                changedByUser: {
                    select: { id: true, firstName: true, lastName: true, email: true },
                },
            },
        }),
    ]);

    return { logs, total, page, limit };
};

module.exports = { log, getAuditLog };
