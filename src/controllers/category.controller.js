const categoryService = require('../services/category.service');
const { success } = require('../utils/response');

// ==========================================
// CATEGORIES
// ==========================================

const createCategory = async (req, res, next) => {
    try {
        const category = await categoryService.createCategory(req.body, req.user.tenantId);
        return success(res, category, 'Category created successfully', 201);
    } catch (error) {
        next(error);
    }
};

const getCategories = async (req, res, next) => {
    try {
        const result = await categoryService.getCategories(req.user.tenantId, req.query);
        return success(res, result.categories, 'Categories fetched successfully', 200, {
            total: result.total,
            skip: parseInt(req.query.skip) || 0,
            take: parseInt(req.query.take) || 10,
        });
    } catch (error) {
        next(error);
    }
};

const getCategory = async (req, res, next) => {
    try {
        const category = await categoryService.getCategoryById(req.params.id, req.user.tenantId);
        return success(res, category, 'Category fetched successfully');
    } catch (error) {
        next(error);
    }
};

const updateCategory = async (req, res, next) => {
    try {
        const category = await categoryService.updateCategory(req.params.id, req.body, req.user.tenantId);
        return success(res, category, 'Category updated successfully');
    } catch (error) {
        next(error);
    }
};

const deleteCategory = async (req, res, next) => {
    try {
        await categoryService.deleteCategory(req.params.id, req.user.tenantId);
        return success(res, null, 'Category deleted successfully');
    } catch (error) {
        next(error);
    }
};

// ==========================================
// SUBCATEGORIES
// ==========================================

const createSubcategory = async (req, res, next) => {
    try {
        const subcategory = await categoryService.createSubcategory(
            req.params.categoryId,
            req.body,
            req.user.tenantId
        );
        return success(res, subcategory, 'Subcategory created successfully', 201);
    } catch (error) {
        next(error);
    }
};

const updateSubcategory = async (req, res, next) => {
    try {
        const subcategory = await categoryService.updateSubcategory(req.params.subcategoryId, req.body, req.user.tenantId);
        return success(res, subcategory, 'Subcategory updated successfully');
    } catch (error) {
        next(error);
    }
};

const deleteSubcategory = async (req, res, next) => {
    try {
        await categoryService.deleteSubcategory(req.params.subcategoryId, req.user.tenantId);
        return success(res, null, 'Subcategory deleted successfully');
    } catch (error) {
        next(error);
    }
};

module.exports = {
    createCategory,
    getCategories,
    getCategory,
    updateCategory,
    deleteCategory,
    createSubcategory,
    updateSubcategory,
    deleteSubcategory
};
