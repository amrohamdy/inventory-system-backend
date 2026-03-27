const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const multer = require('multer');
const path = require('path');

const upload = multer({
    dest: path.join(__dirname, '../../uploads/stock-report/'),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (['.xlsx', '.xls', '.csv'].includes(ext)) cb(null, true);
        else cb(new Error('Only Excel files (.xlsx, .xls) or CSV allowed'));
    },
});

const ctrl = require('../controllers/stockReport.controller');

router.get('/', authenticate, ctrl.getReport);
router.get('/export', authenticate, ctrl.exportReport);
router.post('/upload', authenticate, authorize('ADMIN', 'STOREKEEPER', 'COST_CONTROL'), upload.single('file'), ctrl.uploadCount);

// New workflow routes
router.post('/save', authenticate, authorize('ADMIN', 'STOREKEEPER', 'COST_CONTROL', 'DEPT_MANAGER'), ctrl.saveReport);
router.post('/:id/submit', authenticate, authorize('ADMIN', 'STOREKEEPER', 'COST_CONTROL', 'DEPT_MANAGER'), ctrl.submitReport);
router.post('/:id/approve', authenticate, authorize('ADMIN', 'FINANCE_MANAGER'), ctrl.approveReport);
router.post('/:id/reject', authenticate, authorize('ADMIN', 'FINANCE_MANAGER'), ctrl.rejectReport);
router.get('/saved', authenticate, ctrl.getSavedReports);
router.get('/saved/:id', authenticate, ctrl.getSavedReportById);
router.get('/saved/:id/pdf', authenticate, ctrl.exportPdfReport);

module.exports = router;
