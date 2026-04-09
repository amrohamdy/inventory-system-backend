const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { authorize, requirePermission } = require('../middleware/authorize');
const ctrl = require('../controllers/dashboard.controller');

router.use(authenticate);

router.get('/summary', requirePermission('VIEW_DASHBOARD'), ctrl.getSummary);
router.get('/charts', requirePermission('VIEW_DASHBOARD'), ctrl.getCharts);
router.get(
    '/organization-summary',
    authorize('SUPER_ADMIN', 'ORG_MANAGER'),
    ctrl.getOrganizationSummary,
);

module.exports = router;
