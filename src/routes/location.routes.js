const express = require('express');
const router = express.Router();
const locationController = require('../controllers/location.controller');
const { authenticate: protect } = require('../middleware/authenticate');
const { requirePermission } = require('../middleware/authorize');

router.use(protect);

router
    .route('/')
    .post(requirePermission('BASIC_DATA_EDIT'), locationController.createLocation)
    .get(locationController.getLocations);

router
    .route('/:id')
    .get(locationController.getLocation)
    .put(requirePermission('BASIC_DATA_EDIT'), locationController.updateLocation)
    .delete(requirePermission('BASIC_DATA_EDIT'), locationController.deleteLocation);

router
    .route('/:id/users')
    .post(requirePermission('BASIC_DATA_EDIT'), locationController.assignUser);

router
    .route('/:id/users/:userId')
    .delete(requirePermission('BASIC_DATA_EDIT'), locationController.removeUser);

// ── Location ↔ Category associations ─────────────────────────────────────────
router
    .route('/:id/categories')
    .get(locationController.getLocationCategories)
    .put(requirePermission('BASIC_DATA_EDIT'), locationController.setLocationCategories);

module.exports = router;
