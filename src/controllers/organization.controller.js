const superAdminService = require('../services/superAdmin.service');

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

module.exports = { updateOrganization };
