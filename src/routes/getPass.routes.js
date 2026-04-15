const express = require('express');
const router = express.Router();
const getPassController = require('../controllers/getPass.controller');
const { authenticate: protect } = require('../middleware/authenticate');
const { requireAnyPermission, requirePermission } = require('../middleware/authorize');

router.use(protect);

// Basic CRUD
router.post('/', requirePermission('GET_PASS_CREATE'), getPassController.createGetPass);
router.get('/', requirePermission('GET_PASS_VIEW'), getPassController.getGetPasses);
router.get('/incoming', requirePermission('GET_PASS_VIEW'), getPassController.getIncomingGetPasses);
router.get('/returns', requirePermission('GET_PASS_VIEW'), getPassController.getReturningGetPasses);
router.get(
    '/discrepancies',
    requireAnyPermission('GET_PASS_VIEW', 'REPORTS_VIEW'),
    getPassController.getDiscrepancyClaims
);
router.get(
    '/overdue/check',
    requireAnyPermission('GET_PASS_VIEW', 'REPORTS_VIEW'),
    getPassController.checkOverdueGetPasses
);
router.get('/:id', requirePermission('GET_PASS_VIEW'), getPassController.getGetPassById);
router.put('/:id', requirePermission('GET_PASS_CREATE'), getPassController.updateGetPass);
router.delete('/:id', requirePermission('GET_PASS_CREATE'), getPassController.deleteGetPass);
router.get('/:id/pdf', requirePermission('GET_PASS_VIEW'), getPassController.exportPdf);

// Workflow Actions
router.post('/:id/submit', requirePermission('GET_PASS_CREATE'), getPassController.submitGetPass);
router.post('/:id/approve', getPassController.approveGetPass);
router.post('/:id/reject', getPassController.rejectGetPass);
router.post(
    '/:id/confirm-receipt',
    requirePermission('GET_PASS_CONFIRM_DESTINATION'),
    getPassController.confirmDestinationReceipt
);
router.post('/:id/accept-into-department', getPassController.acceptDestinationDepartment);
router.post('/:id/ship-back', getPassController.shipBackGetPass);
router.post('/:id/confirm-return-exit', getPassController.confirmReturnExit);
router.post('/:id/confirm-return-arrival', getPassController.confirmReturnArrival);
router.post('/:id/accept-return-into-department', getPassController.acceptReturnIntoDepartment);
router.post('/:id/return', requirePermission('GET_PASS_APPROVE_RETURN'), getPassController.returnGetPass);
router.post('/:id/close', requirePermission('GET_PASS_APPROVE_RETURN'), getPassController.closeGetPass);

module.exports = router;
