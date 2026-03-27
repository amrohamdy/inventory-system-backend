const locationService = require('../services/location.service');
const { success } = require('../utils/response');

/**
 * @desc    Create a new location
 * @route   POST /api/locations
 * @access  Private (Admin/Manager)
 */
const createLocation = async (req, res, next) => {
    try {
        const location = await locationService.createLocation(req.body, req.user.tenantId);
        return success(res, location, 'Location created successfully', 201);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Get all locations
 * @route   GET /api/locations
 * @access  Private
 */
const getLocations = async (req, res, next) => {
    try {
        const result = await locationService.getLocations(req.user.tenantId, req.query);
        return success(res, result.locations, 'Locations fetched successfully', 200, {
            total: result.total,
            skip: parseInt(req.query.skip) || 0,
            take: parseInt(req.query.take) || 10,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Get a location by ID
 * @route   GET /api/locations/:id
 * @access  Private
 */
const getLocation = async (req, res, next) => {
    try {
        const location = await locationService.getLocationById(req.params.id, req.user.tenantId);
        return success(res, location, 'Location fetched successfully');
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Update a location
 * @route   PUT /api/locations/:id
 * @access  Private (Admin/Manager)
 */
const updateLocation = async (req, res, next) => {
    try {
        const location = await locationService.updateLocation(req.params.id, req.body, req.user.tenantId);
        return success(res, location, 'Location updated successfully');
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Assign a user to a location
 * @route   POST /api/locations/:id/users
 * @access  Private (Admin/Manager)
 */
const assignUser = async (req, res, next) => {
    try {
        const { userId } = req.body;
        if (!userId) {
            return res.status(400).json({ success: false, message: 'userId is required' });
        }
        const assignment = await locationService.assignUserToLocation(req.params.id, userId, req.user.tenantId);
        return success(res, assignment, 'User assigned to location successfully', 201);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Remove a user from a location
 * @route   DELETE /api/locations/:id/users/:userId
 * @access  Private (Admin/Manager)
 */
const removeUser = async (req, res, next) => {
    try {
        await locationService.removeUserFromLocation(req.params.id, req.params.userId, req.user.tenantId);
        return success(res, null, 'User removed from location successfully');
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Delete a location
 * @route   DELETE /api/locations/:id
 * @access  Private (Admin)
 */
const deleteLocation = async (req, res, next) => {
    try {
        const result = await locationService.deleteLocation(req.params.id, req.user.tenantId);
        return success(res, result, 'Location deleted successfully');
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Get categories linked to a location
 * @route   GET /api/locations/:id/categories
 * @access  Private
 */
const getLocationCategories = async (req, res, next) => {
    try {
        const categories = await locationService.getLocationCategories(req.params.id, req.user.tenantId);
        return success(res, categories, 'Location categories fetched');
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Set (replace) categories linked to a location
 * @route   PUT /api/locations/:id/categories
 * @access  Private (Admin)
 */
const setLocationCategories = async (req, res, next) => {
    try {
        const { categoryIds = [] } = req.body;
        const categories = await locationService.setLocationCategories(req.params.id, categoryIds, req.user.tenantId);
        return success(res, categories, 'Location categories updated');
    } catch (error) {
        next(error);
    }
};

module.exports = {
    createLocation,
    getLocations,
    getLocation,
    updateLocation,
    deleteLocation,
    assignUser,
    removeUser,
    getLocationCategories,
    setLocationCategories,
};
