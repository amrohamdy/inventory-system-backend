const express = require('express');
const router = express.Router();
const reportController = require('../controllers/report.controller');
const summaryReportController = require('../controllers/summaryReport.controller');
const { authenticate: protect } = require('../middleware/authenticate');
const { requirePermission } = require('../middleware/authorize');

router.use(protect);

// New: Summary Inventory Report
router.get('/summary-inventory', requirePermission('REPORTS_VIEW'), summaryReportController.getSummary);

// Valuation Report — As-of-Date
router.get('/valuation', requirePermission('REPORTS_VIEW'), reportController.getValuationReport);

router.post('/generate', requirePermission('REPORTS_VIEW'), reportController.generateReport);
router.get('/history', requirePermission('REPORTS_VIEW'), reportController.getHistory);
router.get('/:id', requirePermission('REPORTS_VIEW'), reportController.getReportById);
router.get('/:id/pdf', requirePermission('REPORTS_EXPORT'), reportController.exportPdf);
router.get('/:id/excel', requirePermission('REPORTS_EXPORT'), reportController.exportExcel);

module.exports = router;
