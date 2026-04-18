const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/lostItems.controller');
const { authenticate } = require('../middleware/authenticate');
const { requireAnyPermission, requirePermission } = require('../middleware/authorize');

router.use(authenticate);
// Same privilege as breakage create (BREAKAGE_CREATE / CREATE_LOST / CREATE_BREAKAGE aliases).
router.post('/', requirePermission('BREAKAGE_CREATE'), ctrl.createLost);
router.get('/', requireAnyPermission('LOST_ITEMS_VIEW', 'VIEW_INVENTORY', 'READ_LOST'), ctrl.listLostItems);
router.get('/:id', requireAnyPermission('LOST_ITEMS_VIEW', 'VIEW_INVENTORY', 'READ_LOST'), ctrl.getLostItem);
router.post('/:id/approve-dept', requirePermission('APPROVE_LOST'), ctrl.approveDept);
router.post('/:id/approve-cost', requirePermission('APPROVE_LOST'), ctrl.approveCost);
router.post('/:id/approve-finance', requirePermission('APPROVE_LOST'), ctrl.approveFinance);
router.post('/:id/approve-gm', requirePermission('APPROVE_LOST'), ctrl.approveGm);
router.post('/:id/approve', requirePermission('APPROVE_LOST'), ctrl.approveLostApprovalStep);
router.post('/:id/reject', requirePermission('APPROVE_LOST'), ctrl.rejectLostApprovalStep);

module.exports = router;
