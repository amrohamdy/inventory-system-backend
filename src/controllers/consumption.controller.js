const consumptionService = require('../services/consumption.service');

const getReport = async (req, res, next) => {
    try {
        const { departmentId, locationId, categoryId, dateFrom, dateTo } = req.query;
        const report = await consumptionService.getConsumptionReport(req.user.tenantId, {
            departmentId, locationId, categoryId, dateFrom, dateTo,
        });
        res.json(report);
    } catch (err) { next(err); }
};

const exportReport = async (req, res, next) => {
    try {
        const { departmentId, locationId, categoryId, dateFrom, dateTo } = req.query;
        const buf = await consumptionService.exportToExcel(req.user.tenantId, {
            departmentId, locationId, categoryId, dateFrom, dateTo,
        });
        res.setHeader('Content-Disposition', `attachment; filename="Consumption_Report.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buf);
    } catch (err) { next(err); }
};

module.exports = { getReport, exportReport };
