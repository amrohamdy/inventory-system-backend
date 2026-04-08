const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/category.controller');
const { authenticate: protect } = require('../middleware/authenticate');
const { requirePermission } = require('../middleware/authorize');

// Apply protection to all category routes
router.use(protect);

// Categories
router
    .route('/')
    .post(requirePermission('BASIC_DATA_EDIT'), categoryController.createCategory)
    .get(categoryController.getCategories);

// Subcategory by id (static prefix before /:id)
router
    .route('/subcategories/:subcategoryId')
    .put(requirePermission('BASIC_DATA_EDIT'), categoryController.updateSubcategory)
    .delete(requirePermission('BASIC_DATA_EDIT'), categoryController.deleteSubcategory);

// GET /api/categories/:id/subcategories (and create)
router
    .route('/:id/subcategories')
    .get(categoryController.getSubcategories)
    .post(requirePermission('BASIC_DATA_EDIT'), categoryController.createSubcategory);

router
    .route('/:id')
    .get(categoryController.getCategory)
    .put(requirePermission('BASIC_DATA_EDIT'), categoryController.updateCategory)
    .delete(requirePermission('BASIC_DATA_EDIT'), categoryController.deleteCategory);

module.exports = router;
