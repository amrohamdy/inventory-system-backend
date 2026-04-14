const express = require('express');
const router = express.Router();
const settingController = require('../controllers/setting.controller');
const { authenticate: protect } = require('../middleware/authenticate');
const { requirePermission, authorize } = require('../middleware/authorize');

// All settings routes require authentication
router.use(protect);

// OB eligibility check — any authenticated user can check
router.get('/ob-eligible', settingController.getOBEligibility);

// Full inventory / OB status (snapshot, locks) — any authenticated user
router.get('/inventory-status', settingController.getInventoryStatus);

// OB lock / enable — tenant-level admins can toggle for their own tenant
router.post('/ob-lock', authorize('SUPER_ADMIN', 'ADMIN'), settingController.lockOB);
router.post('/ob-enable', authorize('SUPER_ADMIN', 'ADMIN', 'ORG_MANAGER'), settingController.enableOB);
router.post('/ob-finalize', authorize('SUPER_ADMIN', 'ADMIN'), settingController.finalizeOpeningBalance);

// Generic setting CRUD
router.route('/:key')
    .get(settingController.getSetting)
    .put(requirePermission('MANAGE_SETTINGS'), settingController.setSetting);

module.exports = router;
