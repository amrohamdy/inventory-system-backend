const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const ctrl = require('../controllers/consumption.controller');

router.get('/', authenticate, ctrl.getReport);
router.get('/export', authenticate, ctrl.exportReport);

module.exports = router;
