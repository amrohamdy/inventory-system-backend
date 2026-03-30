const express = require('express');
const router = express.Router();
const movementController = require('../controllers/movement.controller');
const { authenticate: protect } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');

router.use(protect);

router
    .route('/')
    .post(authorize('SUPER_ADMIN', 'ADMIN', 'STOREKEEPER'), movementController.createMovement)
    .get(movementController.getMovements);

router
    .route('/:id')
    .get(movementController.getMovement)
    .put(authorize('superadmin', 'admin', 'inventory_manager', 'storekeeper'), movementController.updateMovement);

router
    .route('/:id/post')
    .post(authorize('SUPER_ADMIN', 'ADMIN', 'STOREKEEPER'), movementController.postMovement);

module.exports = router;
