const prisma = require('../config/database');
const auditService = require('./audit.service');
const { logAction, EntityType } = require('./auditTrail.service');

const OB_SNAPSHOT_SETTING_KEY = 'obFinalizeSnapshot';

const formatUserDisplayName = (user) => {
    if (!user) return 'Unknown';
    const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
    return name || user.email || 'Unknown';
};

/**
 * Tenant Settings Service
 * Key-value store for tenant-level configuration.
 * Includes Opening Balance eligibility logic.
 */

// ── GET setting ────────────────────────────────────────────────────────────────
const getSetting = async (tenantId, key) => {
    const setting = await prisma.tenantSetting.findUnique({
        where: { tenantId_key: { tenantId, key } },
    });
    if (setting) return setting.value;

    // Keep Opening Balance deterministic for new/legacy tenants.
    if (key === 'allowOpeningBalance') return 'LOCKED';

    return null;
};

// ── SET setting (with audit) ───────────────────────────────────────────────────
const setSetting = async (tenantId, key, value, userId, reason = null) => {
    const before = await prisma.tenantSetting.findUnique({
        where: { tenantId_key: { tenantId, key } },
    });

    const result = await prisma.tenantSetting.upsert({
        where: { tenantId_key: { tenantId, key } },
        update: { value, updatedBy: userId, reason },
        create: { tenantId, key, value, updatedBy: userId, reason },
    });

    // Audit log
    await auditService.log({
        tenantId,
        entityType: 'TenantSetting',
        entityId: key,
        action: before ? 'UPDATE' : 'CREATE',
        changedBy: userId,
        beforeValue: before ? { key, value: before.value, reason: before.reason } : null,
        afterValue: { key, value, reason },
    });

    return result;
};

// ── OB ELIGIBILITY CHECK ───────────────────────────────────────────────────────
/**
 * Determines if Opening Balance import is allowed for a tenant.
 * Rules:
 *   1. If setting = 'LOCKED' → always blocked
 *   2. If setting = 'OPEN'   → admin override, always allowed
 *   3. If no setting         → check posted non-OB movements
 * Returns: { allowed: boolean, reason: string }
 */
const isOpeningBalanceAllowed = async (tenantId) => {
    const lockSetting = await prisma.tenantSetting.findUnique({
        where: { tenantId_key: { tenantId, key: 'allowOpeningBalance' } },
    });

    // Explicitly locked by admin
    if (lockSetting && lockSetting.value === 'LOCKED') {
        return {
            allowed: false,
            reason: lockSetting.reason || 'Opening Balance has been locked by administrator.',
            lockedAt: lockSetting.updatedAt,
        };
    }

    // Explicitly opened by admin — bypass movement check
    if (lockSetting && lockSetting.value === 'OPEN') {
        return { allowed: true, reason: 'Opening Balance enabled by administrator.' };
    }

    // Security default: if setting is missing, OB remains locked until explicitly enabled.
    return {
        allowed: false,
        reason: 'Opening Balance is locked by default. Must be enabled by an administrator.',
    };
};

// ── Clear persisted OB finalize snapshot (e.g. when re-opening OB import) ─────────
const clearObFinalizeSnapshot = async (tenantId) => {
    await prisma.tenantSetting.deleteMany({
        where: { tenantId, key: OB_SNAPSHOT_SETTING_KEY },
    });
};

// ── Inventory / OB status for settings UI and clients ─────────────────────────
const getInventoryStatus = async (tenantId) => {
    const ob = await isOpeningBalanceAllowed(tenantId);
    const allowRow = await prisma.tenantSetting.findUnique({
        where: { tenantId_key: { tenantId, key: 'allowOpeningBalance' } },
    });
    const snapRow = await prisma.tenantSetting.findUnique({
        where: { tenantId_key: { tenantId, key: OB_SNAPSHOT_SETTING_KEY } },
    });

    let snapshotSummary = null;
    if (snapRow?.value) {
        try {
            snapshotSummary = JSON.parse(snapRow.value);
        } catch {
            snapshotSummary = null;
        }
    }

    if (!snapshotSummary && ob.allowed === false) {
        const log = await prisma.auditLog.findFirst({
            where: {
                tenantId,
                entityType: EntityType.SETTINGS,
                entityId: 'allowOpeningBalance',
                action: 'FINALIZE_OB',
            },
            orderBy: { changedAt: 'desc' },
            include: {
                changedByUser: { select: { firstName: true, lastName: true, email: true } },
            },
        });
        if (log?.afterValue && typeof log.afterValue === 'object' && log.afterValue.snapshotSummary) {
            snapshotSummary = log.afterValue.snapshotSummary;
        } else if (log) {
            snapshotSummary = {
                totalItemsCount: null,
                totalOpeningValue: null,
                finalizedAt: log.changedAt.toISOString(),
                finalizedBy: formatUserDisplayName(log.changedByUser),
            };
        }
    }

    return {
        isOpeningBalanceAllowed: ob.allowed,
        reason: ob.reason,
        lockedAt: ob.lockedAt ? ob.lockedAt.toISOString() : null,
        allowOpeningBalance: {
            value: allowRow?.value ?? null,
            reason: allowRow?.reason ?? null,
            updatedAt: allowRow?.updatedAt ? allowRow.updatedAt.toISOString() : null,
        },
        snapshotSummary,
    };
};

// ── FINALIZE OPENING BALANCE (strict validation + lock) ───────────────────────
const finalizeOpeningBalance = async (tenantId, userId) => {
    const [invalidCostRows, draftOBLineRows, itemsMissingBaseUnit] = await Promise.all([
        prisma.stockBalance.findMany({
            where: {
                tenantId,
                qtyOnHand: { gt: 0 },
                wacUnitCost: { lte: 0 },
            },
            select: {
                itemId: true,
                qtyOnHand: true,
                item: { select: { id: true, name: true, code: true } },
                location: { select: { id: true, name: true } },
            },
            orderBy: [{ item: { name: 'asc' } }, { location: { name: 'asc' } }],
        }),
        prisma.movementLine.findMany({
            where: {
                document: {
                    tenantId,
                    movementType: 'OPENING_BALANCE',
                    status: 'DRAFT',
                },
            },
            select: {
                itemId: true,
                document: { select: { documentNo: true } },
            },
            orderBy: [{ document: { documentNo: 'asc' } }, { itemId: 'asc' }],
        }),
        prisma.item.findMany({
            where: {
                tenantId,
                isActive: true,
                itemUnits: {
                    none: { unitType: 'BASE' },
                },
            },
            select: {
                id: true,
                name: true,
                code: true,
            },
            orderBy: { name: 'asc' },
        }),
    ]);

    const invalidCostBalances = invalidCostRows.map((row) => ({
        itemId: row.itemId,
        itemName: row.item?.name || row.item?.code || row.itemId,
        storeName: row.location?.name || '',
        currentQty: Number(row.qtyOnHand),
    }));

    const draftOBMovements = draftOBLineRows.map((row) => ({
        docNo: row.document.documentNo,
        itemId: row.itemId,
    }));

    const itemsMissingBaseUnitPayload = itemsMissingBaseUnit.map((item) => ({
        itemId: item.id,
        itemName: item.name || item.code || item.id,
    }));

    if (
        invalidCostBalances.length > 0
        || draftOBMovements.length > 0
        || itemsMissingBaseUnitPayload.length > 0
    ) {
        const error = new Error('Opening balance finalization failed validation checks.');
        error.statusCode = 400;
        error.code = 'OB_FINALIZE_VALIDATION_FAILED';
        error.details = {
            invalidCostBalances,
            itemsMissingBaseUnit: itemsMissingBaseUnitPayload,
            draftOBMovements,
        };
        throw error;
    }

    const finalizedByUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true, email: true },
    });
    const finalizedByName = formatUserDisplayName(finalizedByUser);

    const result = await prisma.$transaction(async (tx) => {
        const now = new Date();

        const allowSetting = await tx.tenantSetting.upsert({
            where: { tenantId_key: { tenantId, key: 'allowOpeningBalance' } },
            update: {
                value: 'LOCKED',
                updatedBy: userId,
                reason: 'Finalized after strict validation checks.',
                updatedAt: now,
            },
            create: {
                tenantId,
                key: 'allowOpeningBalance',
                value: 'LOCKED',
                updatedBy: userId,
                reason: 'Finalized after strict validation checks.',
                updatedAt: now,
            },
        });

        const booleanSetting = await tx.tenantSetting.upsert({
            where: { tenantId_key: { tenantId, key: 'isOpeningBalanceAllowed' } },
            update: {
                value: 'false',
                updatedBy: userId,
                reason: 'Finalized after strict validation checks.',
                updatedAt: now,
            },
            create: {
                tenantId,
                key: 'isOpeningBalanceAllowed',
                value: 'false',
                updatedBy: userId,
                reason: 'Finalized after strict validation checks.',
                updatedAt: now,
            },
        });

        const balanceRows = await tx.stockBalance.findMany({
            where: { tenantId, qtyOnHand: { gt: 0 } },
            select: { itemId: true, qtyOnHand: true, wacUnitCost: true },
        });
        const distinctItems = new Set();
        let totalOpeningValue = 0;
        for (const b of balanceRows) {
            distinctItems.add(b.itemId);
            totalOpeningValue += Number(b.qtyOnHand) * Number(b.wacUnitCost);
        }
        totalOpeningValue = Math.round(totalOpeningValue * 100) / 100;

        const snapshotSummary = {
            totalItemsCount: distinctItems.size,
            totalOpeningValue,
            finalizedAt: now.toISOString(),
            finalizedBy: finalizedByName,
            currencyCode: 'SAR',
        };

        await tx.tenantSetting.upsert({
            where: { tenantId_key: { tenantId, key: OB_SNAPSHOT_SETTING_KEY } },
            update: {
                value: JSON.stringify(snapshotSummary),
                updatedBy: userId,
                reason: 'Opening balance finalized snapshot',
                updatedAt: now,
            },
            create: {
                tenantId,
                key: OB_SNAPSHOT_SETTING_KEY,
                value: JSON.stringify(snapshotSummary),
                updatedBy: userId,
                reason: 'Opening balance finalized snapshot',
            },
        });

        await logAction({
            tenantId,
            entityType: EntityType.SETTINGS,
            entityId: 'allowOpeningBalance',
            action: 'FINALIZE_OB',
            changedBy: userId,
            note: 'Opening balance finalized and locked after strict validation checks.',
            beforeValue: null,
            afterValue: {
                allowOpeningBalance: allowSetting.value,
                isOpeningBalanceAllowed: booleanSetting.value,
                snapshotSummary,
            },
            tx,
        });

        return {
            finalized: true,
            settings: {
                allowOpeningBalance: allowSetting.value,
                isOpeningBalanceAllowed: booleanSetting.value,
            },
            snapshotSummary,
        };
    });

    return result;
};

module.exports = {
    getSetting,
    setSetting,
    isOpeningBalanceAllowed,
    finalizeOpeningBalance,
    clearObFinalizeSnapshot,
    getInventoryStatus,
};
