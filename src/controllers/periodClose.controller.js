const periodCloseService = require('../services/periodClose.service');

const getPeriods = async (req, res, next) => {
    try {
        const data = await periodCloseService.getPeriods(req.user.tenantId);
        res.json(data);
    } catch (err) { next(err); }
};

const getPeriodById = async (req, res, next) => {
    try {
        const data = await periodCloseService.getPeriodById(req.params.id, req.user.tenantId);
        res.json(data);
    } catch (err) { next(err); }
};

const closePeriod = async (req, res, next) => {
    try {
        const { year, month, notes } = req.body;
        if (!year) return res.status(400).json({ error: 'Year is required' });
        const data = await periodCloseService.closePeriod(
            req.user.tenantId, { year: parseInt(year), month: month ? parseInt(month) : null, notes }, req.user.id
        );
        res.json(data);
    } catch (err) { next(err); }
};

const reopenPeriod = async (req, res, next) => {
    try {
        const data = await periodCloseService.reopenPeriod(req.params.id, req.user.tenantId);
        res.json(data);
    } catch (err) { next(err); }
};

module.exports = { getPeriods, getPeriodById, closePeriod, reopenPeriod };
