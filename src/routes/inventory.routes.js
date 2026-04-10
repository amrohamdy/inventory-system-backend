const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const inventoryController = require('../controllers/inventory.controller');

const router = express.Router();

router.patch(
    '/status',
    authenticate,
    authorize('SUPER_ADMIN', 'ADMIN'),
    inventoryController.patchInventoryStatus,
);

module.exports = router;
