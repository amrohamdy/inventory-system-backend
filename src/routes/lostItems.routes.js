const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/lostItems.controller');
const { authenticate } = require('../middleware/authenticate');
const { requirePermission } = require('../middleware/authorize');

router.use(authenticate);
router.get('/', requirePermission('LOST_ITEMS_VIEW'), ctrl.listLostItems);

module.exports = router;
