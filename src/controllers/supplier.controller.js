const supplierService = require('../services/supplier.service');
const { success } = require('../utils/response');

/**
 * @desc    Create a new supplier
 * @route   POST /api/suppliers
 * @access  Private (Admin/Manager)
 */
const createSupplier = async (req, res, next) => {
    try {
        const supplier = await supplierService.createSupplier(req.body, req.user.tenantId);
        return success(res, supplier, 'Supplier created successfully', 201);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Get all suppliers
 * @route   GET /api/suppliers
 * @access  Private
 */
const getSuppliers = async (req, res, next) => {
    try {
        const result = await supplierService.getSuppliers(req.user.tenantId, req.query);
        return success(res, result.suppliers, 'Suppliers fetched successfully', 200, {
            total: result.total,
            skip: parseInt(req.query.skip) || 0,
            take: parseInt(req.query.take) || 10,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Get supplier by ID
 * @route   GET /api/suppliers/:id
 * @access  Private
 */
const getSupplier = async (req, res, next) => {
    try {
        const supplier = await supplierService.getSupplierById(req.params.id, req.user.tenantId);
        return success(res, supplier, 'Supplier fetched successfully');
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Update a supplier
 * @route   PUT /api/suppliers/:id
 * @access  Private (Admin/Manager)
 */
const updateSupplier = async (req, res, next) => {
    try {
        const supplier = await supplierService.updateSupplier(req.params.id, req.body, req.user.tenantId);
        return success(res, supplier, 'Supplier updated successfully');
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Toggle supplier status
 * @route   PATCH /api/suppliers/:id/status
 * @access  Private (Admin)
 */
const toggleStatus = async (req, res, next) => {
    try {
        const supplier = await supplierService.toggleSupplierStatus(
            req.params.id,
            req.body.isActive,
            req.user.tenantId
        );
        return success(res, supplier, `Supplier state changed to ${req.body.isActive ? 'Active' : 'Inactive'}`);
    } catch (error) {
        next(error);
    }
};

module.exports = {
    createSupplier,
    getSuppliers,
    getSupplier,
    updateSupplier,
    toggleStatus
};
