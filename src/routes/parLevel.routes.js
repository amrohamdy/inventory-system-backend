const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const ctrl = require('../controllers/parLevel.controller');

router.get('/', authenticate, ctrl.getParLevels);
router.put('/', authenticate, authorize('ADMIN', 'STOREKEEPER'), ctrl.updateParLevels);
router.get('/low-stock', authenticate, ctrl.checkLowStock);

module.exports = router;
