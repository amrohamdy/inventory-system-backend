const rolesService = require('../services/roles.service');

/**
 * GET /api/roles — roles for user-management dropdowns (tenant-scoped).
 */
const listRoles = async (req, res, next) => {
    try {
        const data = await rolesService.listAssignableRoles(req.user.tenantId);
        return res.status(200).json({ success: true, data });
    } catch (e) {
        next(e);
    }
};

module.exports = { listRoles };
