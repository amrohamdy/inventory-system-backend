const usersService = require('../services/users.service');
const auditService = require('../services/audit.service');
const { success, created } = require('../utils/response');

/**
 * M01 — Users Controller (Admin operations)
 */

/**
 * GET /api/users
 */
const listUsers = async (req, res) => {
    const { page, limit, role, isActive, search } = req.query;
    const result = await usersService.listUsers(req.user.tenantId, { page, limit, role, isActive, search });

    return res.status(200).json({
        success: true,
        data: result.users,
        meta: {
            page: result.page,
            limit: result.limit,
            total: result.total,
            totalPages: Math.ceil(result.total / result.limit),
            maxUsers: result.maxUsers,
            totalActiveUsers: result.totalActiveUsers,
            // UI: status toggle confirmation — plan slots count active users only.
            deactivateFreesPlanSlotHint:
                'Deactivating this user will free up a slot in your current plan.',
        },
    });
};

/**
 * GET /api/users/search-existing
 */
const searchExistingUsers = async (req, res) => {
    const { email } = req.query;
    const users = await usersService.searchExistingUsers(req.user.id, email);
    return success(res, users);
};

/**
 * GET /api/users/:id
 */
const getUser = async (req, res) => {
    const user = await usersService.getUserById(req.user.tenantId, req.params.id);
    return success(res, user);
};

/**
 * POST /api/users
 */
const createUser = async (req, res) => {
    const {
        email,
        password,
        firstName,
        lastName,
        role,
        phone,
        departmentId,
    } = req.body;

    const user = await usersService.createUser(
        req.user.tenantId,
        {
            email,
            password,
            firstName,
            lastName,
            role,
            phone,
            departmentId,
        },
        req.user.id
    );

    await auditService.log({
        tenantId: req.user.tenantId,
        entityType: 'USER',
        entityId: user.id,
        action: 'CREATE',
        changedBy: req.user.id,
        afterValue: { email: user.email, role: user.role },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
    });

    return created(res, user, 'User created successfully.');
};

/**
 * PUT /api/users/:id
 */
const updateUser = async (req, res) => {
    const before = await usersService.getUserById(req.user.tenantId, req.params.id);
    const updated = await usersService.updateUser(req.user.tenantId, req.params.id, req.body);

    await auditService.log({
        tenantId: req.user.tenantId,
        entityType: 'USER',
        entityId: req.params.id,
        action: 'UPDATE',
        changedBy: req.user.id,
        beforeValue: { firstName: before.firstName, lastName: before.lastName, isActive: before.isActive },
        afterValue: { firstName: updated.firstName, lastName: updated.lastName, isActive: updated.isActive },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
    });

    return success(res, updated, 'User updated successfully.');
};

/**
 * PUT /api/users/:id/role
 */
const updateUserRole = async (req, res) => {
    const { role } = req.body;
    const before = await usersService.getUserById(req.user.tenantId, req.params.id);
    const updated = await usersService.updateUserRole(req.user.tenantId, req.params.id, role, req.user.id);

    await auditService.log({
        tenantId: req.user.tenantId,
        entityType: 'USER',
        entityId: req.params.id,
        action: 'UPDATE',
        changedBy: req.user.id,
        beforeValue: { role: before.role },
        afterValue: { role: updated.role },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
    });

    return success(res, updated, 'User role updated successfully.');
};

module.exports = { listUsers, searchExistingUsers, getUser, createUser, updateUser, updateUserRole };
