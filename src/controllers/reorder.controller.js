const reorderService = require('../services/reorder.service');

const getSuggestions = async (req, res, next) => {
    try {
        const { departmentId, locationId } = req.query;
        const data = await reorderService.getReorderSuggestions(req.user.tenantId, { departmentId, locationId });
        res.json(data);
    } catch (err) { next(err); }
};

module.exports = { getSuggestions };
