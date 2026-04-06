const prisma = require('../config/database');
const auditService = require('./audit.service');

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
    return setting ? setting.value : null;
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
        reason: 'Opening Balance is locked by default. Must be enabled by Super Admin.',
    };
};

module.exports = {
    getSetting,
    setSetting,
    isOpeningBalanceAllowed,
};
