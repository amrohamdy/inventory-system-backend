const lostItemsService = require('../services/lostItems.service');
const { success } = require('../utils/response');

/** GET /api/lost-items */
const listLostItems = async (req, res, next) => {
    try {
        const { items, total } = await lostItemsService.listLostItems(req.user.tenantId, req.query);
        return success(res, items, 'Lost items fetched.', 200, {
            total,
            skip: Number.parseInt(String(req.query.skip), 10) || 0,
            take: Number.parseInt(String(req.query.take), 10) || 20,
        });
    } catch (e) {
        next(e);
    }
};

module.exports = {
    listLostItems,
};
