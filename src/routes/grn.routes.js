'use strict';
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { authorize, requirePermission } = require('../middleware/authorize');
const ctrl = require('../controllers/grn.controller');

router.use(authenticate);

// ── Excel Template & Import Preview (no file needed for template) ──
router.get('/template', requirePermission('GRN_MANAGE'), ctrl.downloadTemplate);
router.post('/import/preview', requirePermission('GRN_MANAGE'), ctrl.uploadExcel, ctrl.previewExcel);
router.post('/import/pdf-preview', requirePermission('GRN_MANAGE'), ctrl.uploadPdf, ctrl.previewPdf);

// ── Create GRN (multipart: invoice file + JSON body) ──
router.post('/', requirePermission('GRN_MANAGE'), ctrl.uploadInvoice, ctrl.createGrn);

// ── List & Detail ──
router.get('/', requirePermission('GRN_VIEW'), ctrl.listGrns);
router.get('/:id', requirePermission('GRN_VIEW'), ctrl.getGrn);

// ── State Machine ──
router.post('/:id/validate', requirePermission('GRN_MANAGE'), ctrl.validateGrn);
router.post('/:id/submit', requirePermission('GRN_MANAGE'), ctrl.submitGrn);
router.post('/:id/approve', requirePermission('GRN_MANAGE'), ctrl.approveGrn);
router.post('/:id/reject', requirePermission('GRN_MANAGE'), ctrl.rejectGrn);
router.post('/:id/resubmit', requirePermission('GRN_MANAGE'), ctrl.resubmitGrn);
router.post(
    '/:id/post',
    authorize('FINANCE_MANAGER', 'ADMIN', 'SUPER_ADMIN', 'ORG_MANAGER'),
    ctrl.postGrn,
);

// ── Mutations (specific PATCH paths before `/:id`) ──
// VALIDATED → APPROVED | REJECTED (Cost Control / Admin), or APPROVED → REJECTED (Finance Manager).
router.patch(
    '/:id/status',
    authorize('COST_CONTROL', 'ADMIN', 'ORG_MANAGER', 'SUPER_ADMIN', 'FINANCE_MANAGER'),
    ctrl.updateGrnStatus,
);
router.patch('/:id', requirePermission('GRN_MANAGE'), ctrl.updateGrn);
router.delete('/:id', requirePermission('GRN_MANAGE'), ctrl.deleteGrn);

module.exports = router;
