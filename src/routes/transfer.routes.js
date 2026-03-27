'use strict';
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { requirePermission } = require('../middleware/authorize');
const ctrl = require('../controllers/transfer.controller');

router.use(authenticate);

router.post('/', requirePermission('TRANSFER_CREATE'), ctrl.createTransfer); // Create DRAFT
router.get('/', requirePermission('INVENTORY_VIEW'), ctrl.listTransfers);
router.get('/:id', requirePermission('INVENTORY_VIEW'), ctrl.getTransfer);
router.patch('/:id', requirePermission('TRANSFER_CREATE'), ctrl.updateTransfer); // DRAFT only
router.delete('/:id', requirePermission('TRANSFER_CREATE'), ctrl.deleteTransfer); // DRAFT only

// State machine
router.post('/:id/submit', requirePermission('TRANSFER_CREATE'), ctrl.submitTransfer);
router.post('/:id/approve', requirePermission('TRANSFER_APPROVE'), ctrl.approveTransfer);
router.post('/:id/reject', requirePermission('TRANSFER_APPROVE'), ctrl.rejectTransfer);
router.post('/:id/dispatch', requirePermission('TRANSFER_DISPATCH_RECEIVE'), ctrl.dispatchTransfer);
router.post('/:id/receive', requirePermission('TRANSFER_DISPATCH_RECEIVE'), ctrl.receiveTransfer);

module.exports = router;
