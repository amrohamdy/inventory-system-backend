const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const ctrl = require('../controllers/reorder.controller');

router.get('/', authenticate, ctrl.getSuggestions);

module.exports = router;
