'use strict';
const path = require('path');
const multer = require('multer');
const grnService = require('../services/grn.service');

// ─── Multer: invoice PDF upload ───────────────────────────────────────────────
const invoiceUpload = multer({
    dest: path.join(__dirname, '../../uploads/grn/invoices'),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req, file, cb) =>
        cb(null, file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')),
});
const uploadInvoice = invoiceUpload.single('invoice');

// ─── Multer: Excel upload ─────────────────────────────────────────────────────
const excelUpload = multer({
    dest: path.join(__dirname, '../../uploads/grn/excel'),
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

// ─── Multer: PDF invoice for parse+preview ───────────────────────
const pdfUpload = multer({
    dest: path.join(__dirname, '../../uploads/grn/pdf'),
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

// ─── Controllers ─────────────────────────────────────────────────────────────

/** POST /api/grn — create a new GRN using items from Item Master */
const createGrn = async (req, res) => {
    try {
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

        const grn = await grnService.createGrn({
            supplierId,
            locationId,
            grnNumber,
            receivingDate,
            invoiceUrl: invoiceFile.path,
            notes,
            lines: parsedLines,
            tenantId: req.user.tenantId,
            userId: req.user.id,
        });

        sendSuccess(res, grn, 201);
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

/** POST /api/grn/:id/post — FINANCE only */
const postGrn = async (req, res) => {
    try {
        assertFinance(req);
        const grn = await grnService.postGrn(
            req.params.id, req.user.tenantId, req.user.id,
        );
        sendSuccess(res, grn);
    } catch (err) {
        sendError(res, err);
    }
};

/** PATCH /api/grn/:id */
const updateGrn = async (req, res) => {
    try {
        const { notes } = req.body;
        const updated = await grnService.updateGrnNotes(
            req.params.id, req.user.tenantId, notes,
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
        const result = await grnService.previewGrnExcel(xlFile.path, req.user.tenantId);
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
        const result = await grnService.previewGrnPdf(pdfFile.path, req.user.tenantId);
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
    postGrn,
    updateGrn,
    deleteGrn,
    downloadTemplate,
    previewExcel,
    previewPdf,
};

