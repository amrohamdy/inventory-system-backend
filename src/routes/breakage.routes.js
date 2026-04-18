const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/breakage.controller');
const { authenticate } = require('../middleware/authenticate');
const { requireAnyPermission, requirePermission } = require('../middleware/authorize');
const { uploadAttachment } = require('../middleware/upload.middleware');

// All routes require authentication
router.use(authenticate);

// ── CRUD ─────────────────────────────────────────────────────────────────────
// Must use BREAKAGE_CREATE (not MANAGE_INVENTORY/MOVEMENT_CREATE): INTERNAL docs start at DEPT_APPROVED with
// step 1 auto-recorded — only roles trusted to open the workflow should create (ADMIN, STOREKEEPER, DEPT_MANAGER).
router.post('/', requirePermission('BREAKAGE_CREATE'), ctrl.createBreakage);
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

// ── Attachments ───────────────────────────────────────────────────────────────
router.post('/:id/attachment', requirePermission('MANAGE_INVENTORY'), uploadAttachment.single('file'), ctrl.uploadAttachment);

// ── Evidence ──────────────────────────────────────────────────────────────────
router.get('/:id/evidence', requireAnyPermission('VIEW_INVENTORY', 'BREAKAGE_VIEW', 'READ_BREAKAGE'), ctrl.getEvidence);
router.get('/:id/evidence/pdf', requireAnyPermission('VIEW_INVENTORY', 'BREAKAGE_VIEW', 'READ_BREAKAGE'), ctrl.getEvidencePDF);

module.exports = router;
