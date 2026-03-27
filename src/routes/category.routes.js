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

router
    .route('/:id')
    .get(categoryController.getCategory)
    .put(requirePermission('BASIC_DATA_EDIT'), categoryController.updateCategory)
    .delete(requirePermission('BASIC_DATA_EDIT'), categoryController.deleteCategory);

// Subcategories
router
    .route('/:categoryId/subcategories')
    .post(requirePermission('BASIC_DATA_EDIT'), categoryController.createSubcategory);

router
    .route('/subcategories/:subcategoryId')
    .put(requirePermission('BASIC_DATA_EDIT'), categoryController.updateSubcategory)
    .delete(requirePermission('BASIC_DATA_EDIT'), categoryController.deleteSubcategory);

module.exports = router;
