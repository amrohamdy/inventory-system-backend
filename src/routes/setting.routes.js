const express = require('express');
const router = express.Router();
const settingController = require('../controllers/setting.controller');
const { authenticate: protect } = require('../middleware/authenticate');
const { requirePermission, authorize } = require('../middleware/authorize');

// All settings routes require authentication
router.use(protect);

// OB eligibility check — any authenticated user can check
router.get('/ob-eligible', settingController.getOBEligibility);

// OB lock / enable — SUPER_ADMIN only (system-level control)
router.post('/ob-lock', authorize('SUPER_ADMIN'), settingController.lockOB);
router.post('/ob-enable', authorize('SUPER_ADMIN'), settingController.enableOB);

// Generic setting CRUD
router.route('/:key')
    .get(settingController.getSetting)
    .put(requirePermission('MANAGE_SETTINGS'), settingController.setSetting);

module.exports = router;
