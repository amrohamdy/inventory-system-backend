const movementService = require('../services/movement.service');
const { success } = require('../utils/response');

/**
 * @desc    Create a new movement document (Draft)
 * @route   POST /api/movements
 * @access  Private
 */
const createMovement = async (req, res, next) => {
    try {
        const document = await movementService.createMovementDraft(
            req.body,
            req.user.tenantId,
            req.user.id
        );
        return success(res, document, 'Movement document created successfully', 201);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Get paginated list of movement documents
 * @route   GET /api/movements
 * @access  Private
 */
const getMovements = async (req, res, next) => {
    try {
        const result = await movementService.getMovements(req.user.tenantId, req.query);
        return success(res, result.documents, 'Movement documents fetched successfully', 200, {
            total: result.total,
            skip: parseInt(req.query.skip) || 0,
            take: parseInt(req.query.take) || 10,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Get movement document by ID
 * @route   GET /api/movements/:id
 * @access  Private
 */
const getMovement = async (req, res, next) => {
    try {
        const document = await movementService.getMovementById(req.params.id, req.user.tenantId);
        return success(res, document, 'Movement document fetched successfully');
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Update a movement document (only if Draft or Rejected)
 * @route   PUT /api/movements/:id
 * @access  Private
 */
const updateMovement = async (req, res, next) => {
    try {
        const document = await movementService.updateMovementDraft(
            req.params.id,
            req.body,
            req.user.tenantId
        );
        return success(res, document, 'Movement document updated successfully');
    } catch (error) {
        next(error);
    }
};

const postMovement = async (req, res, next) => {
    try {
        const document = await require('../services/posting.service').postDocument(
            req.params.id,
            req.user.tenantId,
            req.user.id
        );
        return success(res, document, 'Movement document posted successfully');
    } catch (error) {
        next(error);
    }
};

module.exports = {
    createMovement,
    getMovements,
    getMovement,
    updateMovement,
    postMovement
};
