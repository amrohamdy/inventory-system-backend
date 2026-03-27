const breakageService = require('../services/breakage.service');
const { generateBreakageEvidencePDF } = require('../services/pdf.service');
const { success } = require('../utils/response');

/** POST /api/breakage */
const createBreakage = async (req, res, next) => {
    try {
        const doc = await breakageService.createBreakage(req.body, req.user.tenantId, req.user.id);
        return success(res, doc, 'Breakage document created.', 201);
    } catch (e) { next(e); }
};

/** GET /api/breakage */
const getBreakages = async (req, res, next) => {
    try {
        const { documents, total } = await breakageService.getBreakages(req.user.tenantId, req.query);
        return success(res, documents, 'Breakage documents fetched.', 200, {
            total, skip: parseInt(req.query.skip) || 0, take: parseInt(req.query.take) || 20,
        });
    } catch (e) { next(e); }
};

/** GET /api/breakage/:id */
const getBreakage = async (req, res, next) => {
    try {
        const doc = await breakageService.getBreakageById(req.params.id, req.user.tenantId);
        return success(res, doc, 'Breakage document fetched.');
    } catch (e) { next(e); }
};

/** POST /api/breakage/:id/submit */
const submitBreakage = async (req, res, next) => {
    try {
        const doc = await breakageService.submitBreakage(req.params.id, req.user.tenantId, req.user.id);
        return success(res, doc, 'Breakage submitted for approval.');
    } catch (e) { next(e); }
};

/** POST /api/breakage/:id/approve */
const approveBreakage = async (req, res, next) => {
    try {
        const { comment } = req.body;
        const doc = await breakageService.processApprovalStep(
            req.params.id, req.user.tenantId, req.user.id, req.user.role, 'APPROVE', comment
        );
        return success(res, doc, 'Step approved.');
    } catch (e) { next(e); }
};

/** POST /api/breakage/:id/reject */
const rejectBreakage = async (req, res, next) => {
    try {
        const { comment } = req.body;
        if (!comment?.trim()) {
            return res.status(400).json({ success: false, message: 'Rejection comment is required.' });
        }
        const doc = await breakageService.processApprovalStep(
            req.params.id, req.user.tenantId, req.user.id, req.user.role, 'REJECT', comment
        );
        return success(res, doc, 'Step rejected. Document returned to DRAFT.');
    } catch (e) { next(e); }
};

/** POST /api/breakage/:id/attachment  (multipart/form-data) */
const uploadAttachment = async (req, res, next) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });

        const attachmentMeta = {
            filename: req.file.filename,
            originalName: req.file.originalname,
            url: `/uploads/attachments/${req.file.filename}`,
            mimetype: req.file.mimetype,
            size: req.file.size,
            uploadedBy: `${req.user.firstName || ''} ${req.user.lastName || ''} (${req.user.role})`.trim(),
            uploadedById: req.user.id,
        };

        const doc = await breakageService.addAttachment(req.params.id, req.user.tenantId, attachmentMeta);
        return success(res, doc, 'Attachment added.');
    } catch (e) { next(e); }
};

/** GET /api/breakage/:id/evidence */
const getEvidence = async (req, res, next) => {
    try {
        const evidence = await breakageService.getEvidence(req.params.id, req.user.tenantId);
        return success(res, evidence, 'Evidence pack generated.');
    } catch (e) { next(e); }
};

/** GET /api/breakage/:id/evidence/pdf */
const getEvidencePDF = async (req, res, next) => {
    try {
        const evidence = await breakageService.getEvidence(req.params.id, req.user.tenantId);
        const pdfBuffer = await generateBreakageEvidencePDF(evidence);

        if (!pdfBuffer || pdfBuffer.length === 0) {
            return res.status(500).json({
                success: false,
                message: 'PDF generation produced an empty file. Please contact support.',
            });
        }

        res.status(200)
            .set('Content-Type', 'application/pdf')
            .set('Content-Disposition', `attachment; filename="Evidence-${evidence.header.documentNo}.pdf"`)
            .set('Content-Length', String(pdfBuffer.length))
            .end(pdfBuffer);
    } catch (e) {
        console.error('[PDF ERROR]', e.message);
        next(e);
    }
};

/** POST /api/breakage/:id/void */
const voidBreakage = async (req, res, next) => {
    try {
        const doc = await breakageService.voidBreakage(req.params.id, req.user.tenantId, req.user.id);
        return success(res, doc, 'Breakage document voided.');
    } catch (e) { next(e); }
};

module.exports = {
    createBreakage, getBreakages, getBreakage, submitBreakage,
    approveBreakage, rejectBreakage, uploadAttachment,
    getEvidence, getEvidencePDF, voidBreakage,
};
