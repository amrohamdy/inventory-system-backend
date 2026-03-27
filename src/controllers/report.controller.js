const reportService = require('../services/report.service');
const { success } = require('../utils/response');

const generateReport = async (req, res, next) => {
    try {
        const { reportType, departmentIds, startDate, endDate, categoryId } = req.body;

        const report = await reportService.generateReport(req.user.tenantId, {
            reportType,
            departmentIds: Array.isArray(departmentIds) ? departmentIds : (departmentIds ? [departmentIds] : []),
            startDate,
            endDate,
            categoryId,
            generatedBy: req.user.id
        });

        return success(res, report, 'Report generated successfully', 201);
    } catch (err) {
        next(err);
    }
};

const getHistory = async (req, res, next) => {
    try {
        const { reportType } = req.query;
        const history = await reportService.getHistory(req.user.tenantId, reportType);
        return success(res, history, 'Report history fetched successfully');
    } catch (err) {
        next(err);
    }
};

const getReportById = async (req, res, next) => {
    try {
        const report = await reportService.getReportById(req.user.tenantId, req.params.id);
        return success(res, report, 'Report fetched successfully');
    } catch (err) {
        next(err);
    }
};

const exportExcel = async (req, res, next) => {
    try {
        const wb = await reportService.exportExcel(req.user.tenantId, req.params.id);
        const buf = await wb.xlsx.writeBuffer();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Report_${req.params.id}.xlsx"`);
        res.send(buf);
    } catch (err) {
        next(err);
    }
};

const exportPdf = async (req, res, next) => {
    try {
        const pdfData = await reportService.exportPdf(req.user.tenantId, req.params.id);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Report_${req.params.id}.pdf"`);
        res.send(pdfData);
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/reports/valuation
 * Query params: asOfDate (required), locationIds (comma-separated), departmentIds (comma-separated), categoryId
 */
const getValuationReport = async (req, res, next) => {
    try {
        const { asOfDate, locationIds, departmentIds, categoryId } = req.query;
        if (!asOfDate) return res.status(400).json({ message: 'asOfDate is required' });

        const filters = {
            locationIds:   locationIds   ? locationIds.split(',').filter(Boolean)   : [],
            departmentIds: departmentIds ? departmentIds.split(',').filter(Boolean) : [],
            categoryId:    categoryId    || undefined,
        };

        const data = await reportService.generateValuationReport(req.user.tenantId, asOfDate, filters);
        return success(res, data, 'Valuation report generated');
    } catch (err) {
        next(err);
    }
};

module.exports = {
    generateReport,
    getHistory,
    getReportById,
    exportExcel,
    exportPdf,
    getValuationReport,
};
