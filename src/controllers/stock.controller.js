const stockService = require('../services/stock.service');
const { success } = require('../utils/response');

// GET /api/stock-balances
const getStockBalances = async (req, res, next) => {
    try {
        const result = await stockService.getStockBalances(req.user.tenantId, req.query);
        return success(res, result.balances, 'Stock balances fetched successfully', 200, {
            total: result.total,
            skip: parseInt(req.query.skip) || 0,
            take: parseInt(req.query.take) || 50,
        });
    } catch (err) { next(err); }
};

// GET /api/stock-balances/summary
const getStockSummary = async (req, res, next) => {
    try {
        const result = await stockService.getStockSummary(req.user.tenantId, req.query);
        return success(res, result, 'Stock summary fetched successfully');
    } catch (err) { next(err); }
};

// GET /api/stock-balances/export
const exportStockBalances = async (req, res, next) => {
    try {
        const wb = await stockService.exportStockBalances(req.user.tenantId, req.query);
        const buf = await wb.xlsx.writeBuffer();
        const now = new Date().toISOString().split('T')[0];
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="stock-balances-${now}.xlsx"`);
        res.send(buf);
    } catch (err) { next(err); }
};

// GET /api/stock-balances/:itemId
const getItemStockProfile = async (req, res, next) => {
    try {
        const profile = await stockService.getItemStockProfile(req.params.itemId, req.user.tenantId);
        return success(res, profile, 'Item stock profile fetched successfully');
    } catch (err) { next(err); }
};

module.exports = { getStockBalances, getStockSummary, exportStockBalances, getItemStockProfile };
