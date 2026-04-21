const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const multer = require('multer');
const path = require('path');

// Memory-backed multer: bytes flow through the storage abstraction instead of
// landing on the host filesystem (which is ephemeral on Railway).
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (['.xlsx', '.xls', '.csv'].includes(ext)) cb(null, true);
        else cb(new Error('Only Excel files (.xlsx, .xls) or CSV allowed'));
    },
});

const ctrl = require('../controllers/stockReport.controller');

router.get('/', authenticate, ctrl.getReport);
router.get('/export', authenticate, ctrl.exportReport);
/**
 * @openapi
 * /stock-report/upload:
 *   post:
 *     tags: [Stock Report]
 *     summary: Upload a completed count sheet (Excel/CSV) to record counted quantities
 *     description: >
 *       Matches rows against the active locations for the given department/
 *       year and updates counted quantities. File is parsed and discarded.
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file, departmentId]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: .xlsx / .xls / .csv, max 10 MB
 *               departmentId: { type: string, format: uuid }
 *               categoryId:   { type: string, format: uuid, nullable: true }
 *               year:         { type: string, example: "2026" }
 *     responses:
 *       200:
 *         description: Count recorded with per-row status
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
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
