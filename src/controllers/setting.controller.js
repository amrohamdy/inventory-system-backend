const settingService = require('../services/setting.service');
const { logAction, EntityType } = require('../services/auditTrail.service');
const { success } = require('../utils/response');

// ── GET Setting ────────────────────────────────────────────────────────────────
const getSetting = async (req, res, next) => {
    try {
        const { key } = req.params;
        const value = await settingService.getSetting(req.user.tenantId, key);
        return success(res, { key, value });
    } catch (err) { next(err); }
};

// ── PUT Setting ────────────────────────────────────────────────────────────────
const setSetting = async (req, res, next) => {
    try {
        const { key } = req.params;
        const { value, reason } = req.body;

        if (value === undefined || value === null) {
            const e = new Error('Value is required'); e.statusCode = 400; throw e;
        }

        // OB setting requires SUPER_ADMIN or ADMIN + mandatory reason
        if (key === 'allowOpeningBalance') {
            if (!['SUPER_ADMIN', 'ADMIN'].includes(req.user.role)) {
                const e = new Error('Only SUPER_ADMIN or ADMIN can modify Opening Balance setting');
                e.statusCode = 403; throw e;
            }
            if (value === 'OPEN' && !reason) {
                const e = new Error('A reason is required when unlocking Opening Balance');
                e.statusCode = 400; throw e;
            }
        }

        const result = await settingService.setSetting(
            req.user.tenantId, key, value, req.user.id, reason || null
        );
        return success(res, result, `Setting '${key}' updated.`);
    } catch (err) { next(err); }
};

// ── GET OB Eligibility ─────────────────────────────────────────────────────────
const getOBEligibility = async (req, res, next) => {
    try {
        const result = await settingService.isOpeningBalanceAllowed(req.user.tenantId);
        return success(res, result);
    } catch (err) { next(err); }
};

// ── POST /settings/ob-lock — Lock OB import (SUPER_ADMIN only) ────────────────
const lockOB = async (req, res, next) => {
    try {
        const { reason } = req.body;
        const { tenantId, id: userId, role } = req.user;

        // Defense-in-depth: only SUPER_ADMIN may lock/unlock OB
        if (role !== 'SUPER_ADMIN') {
            const e = new Error('Only Super Admin can lock or unlock Opening Balance. This is a system-level control.');
            e.statusCode = 403; throw e;
        }

        await settingService.setSetting(
            tenantId, 'allowOpeningBalance', 'LOCKED', userId,
            reason || 'Manually locked by Super Administrator'
        );

        await logAction({
            tenantId,
            entityType: EntityType.SETTINGS,
            entityId: 'allowOpeningBalance',
            action: 'LOCK_OB',
            changedBy: userId,
            note: reason || 'OB import locked by Super Administrator',
        });

        return success(res, { locked: true }, 'Opening Balance import has been locked.');
    } catch (err) { next(err); }
};

// ── POST /settings/ob-enable — Enable OB import (SUPER_ADMIN only, reason required) ──
const enableOB = async (req, res, next) => {
    try {
        const { reason } = req.body;
        const { tenantId, id: userId, role } = req.user;

        // Defense-in-depth: only SUPER_ADMIN may lock/unlock OB
        if (role !== 'SUPER_ADMIN') {
            const e = new Error('Only Super Admin can lock or unlock Opening Balance. This is a system-level control.');
            e.statusCode = 403; throw e;
        }

        if (!reason || !reason.trim()) {
            const e = new Error('A reason is required when enabling Opening Balance import.');
            e.statusCode = 400; throw e;
        }

        await settingService.setSetting(
            tenantId, 'allowOpeningBalance', 'OPEN', userId, reason
        );

        await logAction({
            tenantId,
            entityType: EntityType.SETTINGS,
            entityId: 'allowOpeningBalance',
            action: 'REOPEN_PERIOD',
            changedBy: userId,
            note: `OB import enabled by Super Administrator — reason: ${reason}`,
        });

        return success(res, { locked: false }, 'Opening Balance import has been enabled.');
    } catch (err) { next(err); }
};

module.exports = { getSetting, setSetting, getOBEligibility, lockOB, enableOB };
