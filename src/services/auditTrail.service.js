const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Central audit trail logger for OS&E Inventory System.
 *
 * Usage:
 *   await logAction({
 *     tenantId,
 *     entityType: 'MOVEMENT' | 'STOCK_COUNT' | 'PERIOD_CLOSE' | 'ITEM' | ...
 *     entityId,
 *     action: 'CREATE' | 'SUBMIT' | 'POST' | 'APPROVE' | 'REJECT' | 'CLOSE_PERIOD' | 'LOCK_OB' | ...
 *     changedBy,          // userId
 *     note,               // optional human-readable description
 *     beforeValue,        // optional snapshot before change
 *     afterValue,         // optional snapshot after change
 *     tx,                 // optional prisma transaction client
 *   });
 */
const logAction = async ({
    tenantId,
    entityType,
    entityId,
    action,
    changedBy,
    note = null,
    beforeValue = null,
    afterValue = null,
    tx = null,
}) => {
    const client = tx || prisma;
    try {
        await client.auditLog.create({
            data: {
                tenantId,
                entityType,
                entityId,
                action,
                changedBy,
                note,
                beforeValue,
                afterValue,
            },
        });
    } catch (err) {
        // Audit logging must never break main flow
        console.error('[AuditTrail] Failed to log action:', err.message, { tenantId, entityType, entityId, action });
    }
};

// ── Entity Type constants ──────────────────────────────────────────────────
const EntityType = {
    MOVEMENT:       'MOVEMENT',
    STOCK_COUNT:    'STOCK_COUNT',
    PERIOD_CLOSE:   'PERIOD_CLOSE',
    GRN:            'GRN',
    BREAKAGE:       'BREAKAGE',
    TRANSFER:       'TRANSFER',
    ITEM:           'ITEM',
    LOCATION:       'LOCATION',
    DEPARTMENT:     'DEPARTMENT',
    CATEGORY:       'CATEGORY',
    SETTINGS:       'SETTINGS',
    USER:           'USER',
};

module.exports = { logAction, EntityType };
