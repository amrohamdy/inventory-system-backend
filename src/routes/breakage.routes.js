const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/breakage.controller');
const { authenticate } = require('../middleware/authenticate');
const { requireAnyPermission, requirePermission } = require('../middleware/authorize');
const { uploadAttachment, uploadImage } = require('../middleware/upload.middleware');

// All routes require authentication
router.use(authenticate);

// ── CRUD ─────────────────────────────────────────────────────────────────────
// Must use BREAKAGE_CREATE (not MANAGE_INVENTORY/MOVEMENT_CREATE): INTERNAL docs start at DEPT_APPROVED with
// step 1 auto-recorded — only roles trusted to open the workflow should create (ADMIN, STOREKEEPER, DEPT_MANAGER).
router.post('/', requirePermission('BREAKAGE_CREATE'), uploadImage.single('photo'), ctrl.createBreakage);
router.get('/', requireAnyPermission('VIEW_INVENTORY', 'BREAKAGE_VIEW', 'READ_BREAKAGE'), ctrl.getBreakages);
router.get('/:id', requireAnyPermission('VIEW_INVENTORY', 'BREAKAGE_VIEW', 'READ_BREAKAGE'), ctrl.getBreakage);

// ── Workflow ──────────────────────────────────────────────────────────────────
router.post('/:id/submit', requirePermission('MANAGE_INVENTORY'), ctrl.submitBreakage);
router.post('/:id/approve-dept', requirePermission('APPROVE_BREAKAGE'), ctrl.approveDept);
router.post('/:id/approve-cost', requirePermission('APPROVE_BREAKAGE'), ctrl.approveCost);
router.post('/:id/approve-finance', requirePermission('APPROVE_BREAKAGE'), ctrl.approveFinance);
router.post('/:id/approve-gm', requirePermission('APPROVE_BREAKAGE'), ctrl.approveGm);
router.post('/:id/approve', requirePermission('APPROVE_BREAKAGE'), ctrl.approveBreakage);
router.post('/:id/reject', requirePermission('APPROVE_BREAKAGE'), ctrl.rejectBreakage);
router.post('/:id/void', requirePermission('MANAGE_INVENTORY'), ctrl.voidBreakage);

/**
 * @openapi
 * /breakage/{id}/attachment:
 *   post:
 *     tags: [Breakage]
 *     summary: Attach a file (photo / PDF / Office doc) to a breakage document
 *     description: >
 *       Appended to the JSON array stored in `MovementDocument.attachmentUrl`.
 *       Blocked once the document is APPROVED or VOID.
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: .jpg/.png/.webp/.pdf/.doc(x)/.xls(x), max 10 MB
 *     responses:
 *       200:
 *         description: Document with the new attachment appended
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post('/:id/attachment', requirePermission('MANAGE_INVENTORY'), uploadAttachment.single('file'), ctrl.uploadAttachment);

// ── Evidence ──────────────────────────────────────────────────────────────────
router.get('/:id/evidence', requireAnyPermission('VIEW_INVENTORY', 'BREAKAGE_VIEW', 'READ_BREAKAGE'), ctrl.getEvidence);
router.get('/:id/evidence/pdf', requireAnyPermission('VIEW_INVENTORY', 'BREAKAGE_VIEW', 'READ_BREAKAGE'), ctrl.getEvidencePDF);

module.exports = router;
