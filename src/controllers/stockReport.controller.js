const stockReportService = require('../services/stockReport.service');
const path = require('path');
const fs = require('fs');

// GET /api/stock-report
const getReport = async (req, res, next) => {
    try {
        const { departmentId, categoryId, year } = req.query;
        const report = await stockReportService.getStockReport(req.user.tenantId, {
            departmentId,
            categoryId,
            year,
        });
        res.json(report);
    } catch (err) {
        next(err);
    }
};

// GET /api/stock-report/export?blindCount=true
const exportReport = async (req, res, next) => {
    try {
        const { departmentId, categoryId, year, blindCount } = req.query;
        const isBlind = blindCount === 'true' || blindCount === '1';
        const buf = await stockReportService.exportToExcel(
            req.user.tenantId,
            { departmentId, categoryId, year },
            isBlind,
        );

        const filename = isBlind
            ? `Stock_Count_Sheet_${year || new Date().getFullYear()}.xlsx`
            : `Stock_Report_${year || new Date().getFullYear()}.xlsx`;

        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buf);
    } catch (err) {
        next(err);
    }
};

// POST /api/stock-report/upload
const uploadCount = async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        const { departmentId, categoryId, year } = req.body;
        if (!departmentId) {
            return res.status(400).json({ error: 'departmentId is required' });
        }

        const result = await stockReportService.uploadCountedExcel(
            req.file.path,
            req.user.tenantId,
            departmentId,
            categoryId,
            year,
            req.user.id,
        );

        // Cleanup uploaded file
        try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }

        res.json(result);
    } catch (err) {
        if (req.file?.path) {
            try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
        }
        next(err);
    }
};

// POST /api/stock-report/save
const saveReport = async (req, res, next) => {
    try {
        const result = await stockReportService.saveStockReport(
            req.user.tenantId,
            req.user.id,
            req.body
        );
        res.status(201).json(result);
    } catch (err) {
        next(err);
    }
};

// POST /api/stock-report/:id/submit
const submitReport = async (req, res, next) => {
    try {
        const result = await stockReportService.submitStockReport(
            req.params.id,
            req.user.tenantId,
            req.user.id
        );
        res.json(result);
    } catch (err) {
        next(err);
    }
};

// GET /api/stock-report/saved
const getSavedReports = async (req, res, next) => {
    try {
        const reports = await stockReportService.getSavedReports(req.user.tenantId);
        res.json({ data: reports });
    } catch (err) {
        next(err);
    }
};

// GET /api/stock-report/saved/:id
const getSavedReportById = async (req, res, next) => {
    try {
        const report = await stockReportService.getSavedReportById(
            req.params.id,
            req.user.tenantId
        );
        if (!report) return res.status(404).json({ error: 'Report not found' });
        res.json(report);
    } catch (err) {
        next(err);
    }
};

// POST /api/stock-report/:id/approve
const approveReport = async (req, res, next) => {
    try {
        const result = await stockReportService.processApproval(
            req.params.id,
            req.user.tenantId,
            req.user.id,
            'APPROVE'
        );
        res.json(result);
    } catch (err) {
        next(err);
    }
};

// GET /api/stock-report/saved/:id/pdf
const exportPdfReport = async (req, res, next) => {
    try {
        const report = await stockReportService.getSavedReportById(
            req.params.id,
            req.user.tenantId
        );
        if (!report) return res.status(404).json({ error: 'Report not found' });

        const pdfService = require('../services/pdf.service');
        const buf = await pdfService.generateStockReportVariancePDF(report);

        res.setHeader('Content-Disposition', `attachment; filename="Stock_Variance_Report_${report.reportNo}.pdf"`);
        res.setHeader('Content-Type', 'application/pdf');
        res.send(buf);
    } catch (err) {
        next(err);
    }
};

// POST /api/stock-report/:id/reject
const rejectReport = async (req, res, next) => {
    try {
        const { reason } = req.body;
        const result = await stockReportService.processApproval(
            req.params.id,
            req.user.tenantId,
            req.user.id,
            'REJECT',
            reason
        );
        res.json(result);
    } catch (err) {
        next(err);
    }
};

module.exports = {
    getReport,
    exportReport,
    uploadCount,
    saveReport,
    submitReport,
    approveReport,
    rejectReport,
    getSavedReports,
    getSavedReportById,
    exportPdfReport
};
