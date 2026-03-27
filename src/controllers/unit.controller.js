const unitService = require('../services/unit.service');
const { success } = require('../utils/response');

/**
 * @desc    Create a new unit of measure
 * @route   POST /api/units
 * @access  Private (Admin/Manager)
 */
const createUnit = async (req, res, next) => {
    try {
        const unit = await unitService.createUnit(req.body, req.user.tenantId);
        return success(res, unit, 'Unit created successfully', 201);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Get all units of measure
 * @route   GET /api/units
 * @access  Private
 */
const getUnits = async (req, res, next) => {
    try {
        const result = await unitService.getUnits(req.user.tenantId, req.query);
        return success(res, result.units, 'Units fetched successfully', 200, {
            total: result.total,
            skip: parseInt(req.query.skip) || 0,
            take: parseInt(req.query.take) || 50,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Get a unit of measure by ID
 * @route   GET /api/units/:id
 * @access  Private
 */
const getUnit = async (req, res, next) => {
    try {
        const unit = await unitService.getUnitById(req.params.id, req.user.tenantId);
        return success(res, unit, 'Unit fetched successfully');
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Update a unit of measure
 * @route   PUT /api/units/:id
 * @access  Private (Admin/Manager)
 */
const updateUnit = async (req, res, next) => {
    try {
        const unit = await unitService.updateUnit(req.params.id, req.body, req.user.tenantId);
        return success(res, unit, 'Unit updated successfully');
    } catch (error) {
        next(error);
    }
};

module.exports = {
    createUnit,
    getUnits,
    getUnit,
    updateUnit
};
