const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const ctrl = require('../controllers/periodClose.controller');

router.get('/', authenticate, ctrl.getPeriods);
router.get('/:id', authenticate, ctrl.getPeriodById);
router.post('/close', authenticate, authorize('ADMIN', 'FINANCE_MANAGER'), ctrl.closePeriod);
router.post('/:id/reopen', authenticate, authorize('ADMIN'), ctrl.reopenPeriod);

module.exports = router;
