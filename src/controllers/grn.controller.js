'use strict';
const multer = require('multer');
const grnService = require('../services/grn.service');
const periodGuard = require('../services/periodGuard.service');
const { normalizeRole } = require('../services/rbac.service');
const { putBuffer, buildGrnPdfKey } = require('../middleware/upload.middleware');

/** Roles allowed to create GRNs (POST /api/grn). */
const GRN_CREATE_ROLES = ['COST_CONTROL', 'STOREKEEPER', 'ADMIN', 'SUPER_ADMIN', 'ORG_MANAGER'];

// ─── Multer (memory-backed; bytes are forwarded to storage.put below) ────────
const memoryStorage = multer.memoryStorage();

const invoiceUpload = multer({
    storage: memoryStorage,
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req, file, cb) =>
        cb(null, file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')),
});
const uploadInvoice = invoiceUpload.single('invoice');

const excelUpload = multer({
    storage: memoryStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ok = file.mimetype.includes('spreadsheet') ||
            file.mimetype.includes('excel') ||
            file.originalname.endsWith('.xlsx') ||
            file.originalname.endsWith('.xls') ||
            file.originalname.endsWith('.csv');
        cb(null, ok);
    },
});
const uploadExcel = excelUpload.single('file');

const pdfUpload = multer({
    storage: memoryStorage,
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req, file, cb) =>
        cb(null, file.mimetype === 'application/pdf' || file.originalname.endsWith('.pdf')),
});
const uploadPdf = pdfUpload.single('file');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const sendSuccess = (res, data, status = 200) =>
    res.status(status).json({ success: true, data });

const sendError = (res, err) => {
    const status = err.status || err.statusCode || 500;
    res.status(status).json({ success: false, message: err.message, details: err.details });
};

const assertFinance = (req) => {
    const role = req.user?.role;
    if (!['FINANCE_MANAGER', 'COST_CONTROL', 'ADMIN'].includes(role))
        throw Object.assign(
            new Error('Insufficient permissions. Finance role required.'),
            { status: 403 }
        );
};

/** POST /api/grn/:id/post — Finance Manager or Admin only (not Cost Control). */
const assertPostGrnRole = (req) => {
    const role = normalizeRole(req.user?.role);
    if (!['FINANCE_MANAGER', 'ADMIN', 'SUPER_ADMIN', 'ORG_MANAGER'].includes(role))
        throw Object.assign(
            new Error('Insufficient permissions to post this GRN to the ledger.'),
            { status: 403 }
        );
};

/** PATCH /api/grn/:id/status — VALIDATED → APPROVED | REJECTED (Cost Control / Admin / …), or APPROVED → REJECTED (Finance Manager). */
const GRN_STATUS_UPDATE_ROLES = ['COST_CONTROL', 'ADMIN', 'ORG_MANAGER', 'SUPER_ADMIN'];

const assertPatchGrnStatusRole = (req) => {
    const role = normalizeRole(req.user?.role);
    if (role === 'FINANCE_MANAGER') return;
    if (!GRN_STATUS_UPDATE_ROLES.includes(role))
        throw Object.assign(
            new Error('Insufficient permissions to approve or reject this GRN at this stage.'),
            { status: 403 }
        );
};

const assertGrnCreateRole = (req) => {
    const role = normalizeRole(req.user?.role);
    if (!GRN_CREATE_ROLES.includes(role)) {
        throw Object.assign(new Error('Permission denied. You cannot create goods receipt notes.'), {
            status: 403,
        });
    }
};

// ─── Controllers ─────────────────────────────────────────────────────────────

/** POST /api/grn — create a new GRN using items from Item Master */
const createGrn = async (req, res) => {
    try {
        await periodGuard.assertOperationalTransactionsAllowed(req.user.tenantId);
        assertGrnCreateRole(req);

        const invoiceFile = req.file;
        if (!invoiceFile)
            return res.status(400).json({ success: false, message: 'Invoice attachment (PDF or image) is required.' });

        const { supplierId, locationId, grnNumber, receivingDate, notes, lines } = req.body;

        if (!supplierId) return res.status(400).json({ success: false, message: 'supplierId is required.' });
        if (!locationId) return res.status(400).json({ success: false, message: 'locationId is required.' });
        if (!grnNumber) return res.status(400).json({ success: false, message: 'GRN/Invoice number is required.' });

        // lines comes as JSON string from multipart
        let parsedLines;
        try {
            parsedLines = typeof lines === 'string' ? JSON.parse(lines) : lines;
        } catch {
            return res.status(400).json({ success: false, message: 'Invalid lines format — expected JSON array.' });
        }

        // Persist the invoice via the storage provider. Under local driver the key
        // looks like `/uploads/attachments/grn-...` (legacy format), under r2 it's
        // `tenants/{tenantId}/grn/...`.
        const invoiceKey = buildGrnPdfKey(req.user.tenantId, null, invoiceFile.originalname);
        await putBuffer(invoiceKey, invoiceFile);

        const created = await grnService.createGrn({
            supplierId,
            locationId,
            grnNumber,
            receivingDate,
            invoiceUrl: invoiceKey,
            notes,
            lines: parsedLines,
            tenantId: req.user.tenantId,
            userId: req.user.id,
            creatorRole: normalizeRole(req.user.role),
        });

        if (created.autoPosted) {
            const { autoPosted: _omit, ...data } = created;
            return res.status(201).json({
                success: true,
                message: 'GRN Created and Posted Successfully',
                data,
                autoPosted: true,
            });
        }

        sendSuccess(res, created, 201);
    } catch (err) {
        sendError(res, err);
    }
};

/** GET /api/grn */
const listGrns = async (req, res) => {
    try {
        const { status, page, limit } = req.query;
        const result = await grnService.listGrns(req.user.tenantId, {
            status,
            page: +page || 1,
            limit: +limit || 20,
        });
        sendSuccess(res, result);
    } catch (err) {
        sendError(res, err);
    }
};

/** GET /api/grn/:id */
const getGrn = async (req, res) => {
    try {
        const grn = await grnService.getGrn(req.params.id, req.user.tenantId);
        sendSuccess(res, grn);
    } catch (err) {
        sendError(res, err);
    }
};

/** POST /api/grn/:id/validate */
const validateGrn = async (req, res) => {
    try {
        const grn = await grnService.validateGrn(req.params.id, req.user.tenantId);
        sendSuccess(res, grn);
    } catch (err) {
        sendError(res, err);
    }
};

/** POST /api/grn/:id/submit */
const submitGrn = async (req, res) => {
    try {
        const grn = await grnService.submitForApproval(
            req.params.id, req.user.tenantId, req.user.id,
        );
        sendSuccess(res, grn);
    } catch (err) {
        sendError(res, err);
    }
};

/** POST /api/grn/:id/approve — FINANCE only */
const approveGrn = async (req, res) => {
    try {
        assertFinance(req);
        const grn = await grnService.approveGrn(
            req.params.id, req.user.tenantId, req.user.id, req.body.comment,
        );
        sendSuccess(res, grn);
    } catch (err) {
        sendError(res, err);
    }
};

/** POST /api/grn/:id/reject — FINANCE only */
const rejectGrn = async (req, res) => {
    try {
        assertFinance(req);
        const { reason } = req.body;
        if (!reason)
            return res.status(400).json({ success: false, message: 'Rejection reason is required.' });
        const grn = await grnService.rejectGrn(
            req.params.id, req.user.tenantId, req.user.id, reason,
        );
        sendSuccess(res, grn);
    } catch (err) {
        sendError(res, err);
    }
};

/** POST /api/grn/:id/resubmit — REJECTED → VALIDATED | APPROVED */
const resubmitGrn = async (req, res) => {
    try {
        const grn = await grnService.resubmitRejectedGrn(
            req.params.id,
            req.user.tenantId,
            req.user.id,
            normalizeRole(req.user.role),
        );
        sendSuccess(res, grn);
    } catch (err) {
        sendError(res, err);
    }
};

/** POST /api/grn/:id/post — Finance / Admin only */
const postGrn = async (req, res) => {
    try {
        assertPostGrnRole(req);
        const grn = await grnService.postGrn(
            req.params.id, req.user.tenantId, req.user.id,
        );
        sendSuccess(res, grn);
    } catch (err) {
        sendError(res, err);
    }
};

/** PATCH /api/grn/:id/status */
const updateGrnStatus = async (req, res) => {
    try {
        assertPatchGrnStatusRole(req);
        const role = normalizeRole(req.user?.role);
        const { status, reason } = req.body || {};
        if (status !== 'APPROVED' && status !== 'REJECTED')
            return res.status(400).json({ success: false, message: 'status must be APPROVED or REJECTED.' });
        if (role === 'FINANCE_MANAGER' && status !== 'REJECTED')
            return res.status(403).json({
                success: false,
                message:
                    'Finance managers may only set status to REJECTED (to return an approved GRN before posting).',
            });
        if (status === 'REJECTED') {
            const r = typeof reason === 'string' ? reason.trim() : '';
            if (!r)
                return res.status(400).json({ success: false, message: 'Rejection reason is required.' });
        }
        const grn = await grnService.updateStatus(
            req.params.id,
            req.user.tenantId,
            status,
            status === 'REJECTED' ? String(reason).trim() : null,
            req.user.id,
            role,
        );
        sendSuccess(res, grn);
    } catch (err) {
        sendError(res, err);
    }
};

/** PATCH /api/grn/:id — notes and/or lines (lines only when REJECTED) */
const updateGrn = async (req, res) => {
    try {
        const { notes, lines } = req.body || {};
        const updated = await grnService.updateGrn(
            req.params.id, req.user.tenantId, { notes, lines }, req.user.id,
        );
        sendSuccess(res, updated);
    } catch (err) {
        sendError(res, err);
    }
};

/** DELETE /api/grn/:id — DRAFT only */
const deleteGrn = async (req, res) => {
    try {
        await grnService.deleteGrn(req.params.id, req.user.tenantId);
        res.status(200).json({ success: true, message: 'GRN deleted.' });
    } catch (err) {
        sendError(res, err);
    }
};

/** GET /api/grn/template */
const downloadTemplate = async (req, res) => {
    try {
        const wb = await grnService.generateGrnTemplate();
        const buffer = await wb.xlsx.writeBuffer();
        res.setHeader('Content-Disposition', 'attachment; filename="GRN_Template.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Length', buffer.length);
        res.send(buffer);
    } catch (err) {
        sendError(res, err);
    }
};

/** POST /api/grn/import/preview — parse Excel and validate rows */
const previewExcel = async (req, res) => {
    try {
        const xlFile = req.file;
        if (!xlFile)
            return res.status(400).json({ success: false, message: 'Excel file is required.' });
        const result = await grnService.previewGrnExcel(xlFile.buffer, req.user.tenantId);
        sendSuccess(res, result);
    } catch (err) {
        sendError(res, err);
    }
};

/** POST /api/grn/import/pdf-preview — parse PDF and validate rows */
const previewPdf = async (req, res) => {
    try {
        const pdfFile = req.file;
        if (!pdfFile)
            return res.status(400).json({ success: false, message: 'PDF file is required.' });
        const result = await grnService.previewGrnPdf(pdfFile.buffer, req.user.tenantId);
        sendSuccess(res, result);
    } catch (err) {
        sendError(res, err);
    }
};

module.exports = {
    uploadInvoice,
    uploadExcel,
    uploadPdf,
    createGrn,
    listGrns,
    getGrn,
    validateGrn,
    submitGrn,
    approveGrn,
    rejectGrn,
    resubmitGrn,
    postGrn,
    updateGrnStatus,
    updateGrn,
    deleteGrn,
    downloadTemplate,
    previewExcel,
    previewPdf,
};

