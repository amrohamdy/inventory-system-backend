const express = require('express');
const router = express.Router();
const getPassController = require('../controllers/getPass.controller');
const { authenticate: protect } = require('../middleware/authenticate');
const { requirePermission } = require('../middleware/authorize');

router.use(protect);

// Basic CRUD
router.post('/', requirePermission('GET_PASS_CREATE'), getPassController.createGetPass);
router.get('/', requirePermission('GET_PASS_VIEW'), getPassController.getGetPasses);
router.get('/:id', requirePermission('GET_PASS_VIEW'), getPassController.getGetPassById);
router.put('/:id', requirePermission('GET_PASS_CREATE'), getPassController.updateGetPass);
router.delete('/:id', requirePermission('GET_PASS_CREATE'), getPassController.deleteGetPass);
router.get('/:id/pdf', requirePermission('GET_PASS_VIEW'), getPassController.exportPdf);

// Workflow Actions
router.post('/:id/submit', requirePermission('GET_PASS_CREATE'), getPassController.submitGetPass);
router.post('/:id/approve', requirePermission('GET_PASS_APPROVE'), getPassController.approveGetPass);
router.post('/:id/checkout', requirePermission('GET_PASS_APPROVE_EXIT'), getPassController.checkoutGetPass);
router.post('/:id/return', requirePermission('GET_PASS_APPROVE_RETURN'), getPassController.returnGetPass);
router.post('/:id/close', requirePermission('GET_PASS_APPROVE_RETURN'), getPassController.closeGetPass);

module.exports = router;
