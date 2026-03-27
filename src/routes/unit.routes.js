const express = require('express');
const router = express.Router();
const unitController = require('../controllers/unit.controller');
const { authenticate: protect } = require('../middleware/authenticate');
const { requirePermission } = require('../middleware/authorize');

router.use(protect);

router
    .route('/')
    .post(requirePermission('BASIC_DATA_EDIT'), unitController.createUnit)
    .get(unitController.getUnits);

router
    .route('/:id')
    .get(unitController.getUnit)
    .put(requirePermission('BASIC_DATA_EDIT'), unitController.updateUnit);

module.exports = router;
