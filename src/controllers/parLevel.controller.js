const parLevelService = require('../services/parLevel.service');

const getParLevels = async (req, res, next) => {
    try {
        const { locationId, categoryId } = req.query;
        if (!locationId) return res.status(400).json({ error: 'locationId is required' });
        const data = await parLevelService.getParLevels(req.user.tenantId, locationId, { categoryId });
        res.json(data);
    } catch (err) { next(err); }
};

const updateParLevels = async (req, res, next) => {
    try {
        const { updates } = req.body;
        if (!updates || !Array.isArray(updates)) return res.status(400).json({ error: 'updates array required' });
        const data = await parLevelService.updateParLevels(req.user.tenantId, updates);
        res.json(data);
    } catch (err) { next(err); }
};

const checkLowStock = async (req, res, next) => {
    try {
        const { locationId } = req.query;
        const data = await parLevelService.checkLowStock(req.user.tenantId, locationId);
        res.json({ count: data.length, items: data });
    } catch (err) { next(err); }
};

module.exports = { getParLevels, updateParLevels, checkLowStock };
