const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/breakage.controller');
const { authenticate } = require('../middleware/authenticate');
const { requirePermission } = require('../middleware/authorize');
const { uploadAttachment } = require('../middleware/upload.middleware');

// All routes require authentication
router.use(authenticate);

// ── CRUD ─────────────────────────────────────────────────────────────────────
router.post('/', requirePermission('MANAGE_INVENTORY'), ctrl.createBreakage);
router.get('/', requirePermission('VIEW_INVENTORY'), ctrl.getBreakages);
router.get('/:id', requirePermission('VIEW_INVENTORY'), ctrl.getBreakage);

// ── Workflow ──────────────────────────────────────────────────────────────────
router.post('/:id/submit', requirePermission('MANAGE_INVENTORY'), ctrl.submitBreakage);
router.post('/:id/approve', requirePermission('APPROVE_BREAKAGE'), ctrl.approveBreakage);
router.post('/:id/reject', requirePermission('APPROVE_BREAKAGE'), ctrl.rejectBreakage);
router.post('/:id/void', requirePermission('MANAGE_INVENTORY'), ctrl.voidBreakage);

// ── Attachments ───────────────────────────────────────────────────────────────
router.post('/:id/attachment', requirePermission('MANAGE_INVENTORY'), uploadAttachment.single('file'), ctrl.uploadAttachment);

// ── Evidence ──────────────────────────────────────────────────────────────────
router.get('/:id/evidence', requirePermission('VIEW_INVENTORY'), ctrl.getEvidence);
router.get('/:id/evidence/pdf', requirePermission('VIEW_INVENTORY'), ctrl.getEvidencePDF);

module.exports = router;
