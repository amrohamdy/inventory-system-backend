const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplier.controller');
const { authenticate: protect } = require('../middleware/authenticate');
const { requirePermission } = require('../middleware/authorize');

router.use(protect);

router
    .route('/')
    .post(requirePermission('BASIC_DATA_EDIT'), supplierController.createSupplier)
    .get(supplierController.getSuppliers);

router
    .route('/:id')
    .get(supplierController.getSupplier)
    .put(requirePermission('BASIC_DATA_EDIT'), supplierController.updateSupplier);

router
    .route('/:id/status')
    .patch(requirePermission('BASIC_DATA_EDIT'), supplierController.toggleStatus);

module.exports = router;
