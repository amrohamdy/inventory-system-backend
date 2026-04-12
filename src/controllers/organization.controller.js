const superAdminService = require('../services/superAdmin.service');
const organizationService = require('../services/organization.service');
const { success } = require('../utils/response');

const getSisterHotels = async (req, res, next) => {
    try {
        const data = await organizationService.getSisterHotels(req.user.tenantId);
        return success(res, data);
    } catch (e) {
        next(e);
    }
};

const updateOrganization = async (req, res, next) => {
    try {
        const data = await superAdminService.updateOrganization(
            req.params.id,
            req.body,
            req.user.id,
            req.ip
        );
        res.json({ success: true, data });
    } catch (e) {
        next(e);
    }
};

module.exports = { updateOrganization, getSisterHotels };
