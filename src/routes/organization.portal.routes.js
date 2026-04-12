const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { requireAnyPermission } = require('../middleware/authorize');
const organizationController = require('../controllers/organization.controller');

router.use(authenticate);

// GET /api/organization/sister-hotels — hotels under the same organization (excl. current when on a branch)
router.get(
    '/sister-hotels',
    requireAnyPermission('GET_PASS_CREATE', 'GET_PASS_VIEW'),
    organizationController.getSisterHotels
);

module.exports = router;
