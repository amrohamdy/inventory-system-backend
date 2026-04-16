const itemService = require('../services/item.service');
const settingService = require('../services/setting.service');
const { logAction, EntityType } = require('../services/auditTrail.service');
const { success } = require('../utils/response');
const { normalizeRole } = require('../services/rbac.service');

const canManageTenantOpeningBalance = (role) =>
    ['SUPER_ADMIN', 'ADMIN', 'ORG_MANAGER'].includes(normalizeRole(role));

/**
 * PATCH /inventory/status — align tenant OB phase with `isOpeningBalanceAllowed` (API contract).
 * When true: same as POST /settings/ob-enable (OPEN + DB flag + clear snapshot).
 */
const patchInventoryStatus = async (req, res, next) => {
    try {
        const { isOpeningBalanceAllowed, reason } = req.body;
        const { tenantId, id: userId, role } = req.user;

        if (!canManageTenantOpeningBalance(role)) {
            const e = new Error('Only tenant administrators can update inventory status.');
            e.statusCode = 403;
            throw e;
        }

        if (typeof isOpeningBalanceAllowed !== 'boolean') {
            const e = new Error('Request body must include isOpeningBalanceAllowed (boolean).');
            e.statusCode = 400;
            throw e;
        }

        if (isOpeningBalanceAllowed === false) {
            const e = new Error('To disable opening balance import, use POST /settings/ob-lock with a reason.');
            e.statusCode = 400;
            throw e;
        }

        const normalizedReason = (reason && String(reason).trim()) || 'Initial Setup';

        await settingService.enableOpeningBalanceStage(tenantId, userId, normalizedReason);

        await logAction({
            tenantId,
            entityType: EntityType.SETTINGS,
            entityId: 'allowOpeningBalance',
            action: 'REOPEN_PERIOD',
            changedBy: userId,
            note: `OB stage enabled via PATCH /inventory/status — reason: ${normalizedReason}`,
        });

        const data = await settingService.getInventoryStatus(tenantId);
        return success(res, data, 'Opening balance stage enabled.');
    } catch (err) {
        next(err);
    }
};

/**
 * GET /inventory/items-by-locations/:locationId — catalog for GRN / receiving at this warehouse.
 */
const getItemsByLocation = async (req, res, next) => {
    try {
        const { locationId } = req.params;
        const data = await itemService.getItemsByLocationId(req.user.tenantId, locationId, req.query);
        return success(res, data, 'Items fetched successfully');
    } catch (err) {
        next(err);
    }
};

/**
 * GET /inventory/items-by-locations/:locationId/select — list-select source (no pagination).
 */
const getItemsByLocationSelect = async (req, res, next) => {
    try {
        const { locationId } = req.params;
        const data = await itemService.getAllItemsByLocationId(req.user.tenantId, locationId, req.query);
        return success(res, data, 'Items fetched successfully');
    } catch (err) {
        next(err);
    }
};

module.exports = {
    patchInventoryStatus,
    getItemsByLocation,
    getItemsByLocationSelect,
};
