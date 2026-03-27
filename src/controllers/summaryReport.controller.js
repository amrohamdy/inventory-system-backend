const { getSummaryReport } = require('../services/summaryReport.service');
const { success } = require('../utils/response');

const getSummary = async (req, res, next) => {
    try {
        const { startDate, endDate, departmentIds, categoryId } = req.query;
        const dIds = departmentIds ? departmentIds.split(',').map(id => id.trim()).filter(Boolean) : [];
        const data = await getSummaryReport(req.user.tenantId, { startDate, endDate, departmentIds: dIds, categoryId });
        return success(res, data, 'Summary report generated');
    } catch (err) { next(err); }
};

module.exports = { getSummary };
