const express = require('express');
const router = express.Router();
const stockCountController = require('../controllers/stockCount.controller');
const { authenticate } = require('../middleware/authenticate');
const { requirePermission } = require('../middleware/authorize');

router.use(authenticate);

router.post('/', requirePermission('MANAGE_INVENTORY'), stockCountController.createSession);
router.get('/', requirePermission('VIEW_INVENTORY'), stockCountController.getSessions);
router.get('/:id', requirePermission('VIEW_INVENTORY'), stockCountController.getSession);

// Update count lines (partial or full saves)
router.put('/:id/lines', requirePermission('MANAGE_INVENTORY'), stockCountController.updateLines);

// Workflow actions
router.post('/:id/submit', requirePermission('MANAGE_INVENTORY'), stockCountController.submitForApproval);
router.post('/:id/approve', stockCountController.processApproval); // RBAC handled in service
router.post('/:id/void', requirePermission('MANAGE_INVENTORY'), stockCountController.voidSession); // Usually admin only but mapped to manage inventory for now

// Evidence Pack
router.get('/:id/evidence', stockCountController.getEvidencePack);
router.get('/:id/evidence/pdf', stockCountController.downloadEvidencePdf);
router.get('/:id/evidence/excel', stockCountController.downloadExcel);


module.exports = router;
