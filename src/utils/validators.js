const { body, query, param, validationResult } = require('express-validator');

/**
 * Validate and extract errors from express-validator results
 */
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed.',
            errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
        });
    }
    next();
};

// ─── Auth Validators ───────────────────────────────────────────────────────
const loginValidator = [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),
    body('password').notEmpty().withMessage('Password is required.'),
    body('tenantSlug').optional().trim(), // Optional — SUPER_ADMIN logs in without a tenant
    validate,
];

const refreshValidator = [
    body('refreshToken').notEmpty().withMessage('Refresh token is required.'),
    validate,
];

// ─── User Validators ───────────────────────────────────────────────────────
const createUserValidator = [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),
    body('password').optional().isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
    body('firstName').optional().notEmpty().trim(),
    body('lastName').optional().notEmpty().trim(),
    body('role')
        .isIn(['ADMIN', 'ORG_MANAGER', 'STOREKEEPER', 'DEPT_MANAGER', 'COST_CONTROL', 'FINANCE_MANAGER', 'AUDITOR', 'SECURITY'])
        .withMessage('Invalid role.'),
    body('departmentId').optional({ nullable: true }).isUUID().withMessage('departmentId must be a valid UUID.'),
    validate,
];

const updateUserValidator = [
    body('firstName').optional().notEmpty().trim(),
    body('lastName').optional().notEmpty().trim(),
    body('password').optional().isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
    body('role')
        .optional()
        .isIn(['ADMIN', 'ORG_MANAGER', 'STOREKEEPER', 'DEPT_MANAGER', 'COST_CONTROL', 'FINANCE_MANAGER', 'AUDITOR', 'SECURITY'])
        .withMessage('Invalid role.'),
    body('isActive').optional().isBoolean(),
    validate,
];

const updateRoleValidator = [
    body('role')
        .isIn(['ADMIN', 'ORG_MANAGER', 'STOREKEEPER', 'DEPT_MANAGER', 'COST_CONTROL', 'FINANCE_MANAGER', 'AUDITOR', 'SECURITY'])
        .withMessage('Invalid role.'),
    validate,
];

// ─── Pagination Validator ──────────────────────────────────────────────────
const paginationValidator = [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    validate,
];

const searchExistingUsersValidator = [
    query('email')
        .notEmpty()
        .withMessage('email query is required.')
        .bail()
        .isLength({ min: 2 })
        .withMessage('email query must be at least 2 characters.')
        .trim(),
    validate,
];

// ─── Tenant Validators ───────────────────────────────────────────────────────
const createTenantValidator = [
    body('name').notEmpty().withMessage('name is required.').trim(),
    body('slug').notEmpty().withMessage('slug is required.').trim(),
    body('parentId').optional({ nullable: true }).isUUID().withMessage('parentId must be a valid UUID.'),
    body('status')
        .optional()
        .isIn(['TRIAL', 'ACTIVE'])
        .withMessage('status must be one of TRIAL, ACTIVE.'),
    body('subStatus')
        .optional()
        .isIn(['TRIAL', 'ACTIVE'])
        .withMessage('subStatus must be one of TRIAL, ACTIVE.'),
    body().custom((value) => {
        const isOrg = !value?.parentId;
        const requestedSubStatus = value?.status ?? value?.subStatus;
        if (isOrg && requestedSubStatus && requestedSubStatus !== 'ACTIVE') {
            throw new Error('Organizations must be created with ACTIVE status.');
        }
        if (!isOrg) {
            const subStatus = requestedSubStatus;
            if (!subStatus) throw new Error('status is required for hotel creation.');
            if (subStatus === 'TRIAL') {
                // licenseEndDate will be calculated server-side if omitted
                return true;
            }
        }
        return true;
    }),
    body('maxUsers')
        .optional()
        .isInt({ min: 1 })
        .withMessage('maxUsers must be a positive integer.'),
    body('licenseStartDate').optional().isISO8601().withMessage('licenseStartDate must be a valid ISO date.'),
    body('licenseEndDate').optional({ nullable: true }).isISO8601().withMessage('licenseEndDate must be a valid ISO date.'),
    body('planType').optional().isIn(['BASIC', 'PRO', 'ENTERPRISE', 'CUSTOM']).withMessage('Invalid planType.'),
    body('hasBranches').optional().isBoolean().withMessage('hasBranches must be boolean.'),
    body('maxBranches').optional().isInt({ min: 0 }).withMessage('maxBranches must be a non-negative integer.'),
    body('adminUser.email').isEmail().withMessage('adminUser.email is required.').normalizeEmail(),
    body('adminUser.password').optional().isLength({ min: 8 }).withMessage('adminUser.password must be at least 8 characters.'),
    body('adminUser.firstName').optional().notEmpty().trim(),
    body('adminUser.lastName').optional().notEmpty().trim(),
    validate,
];

const createSuperAdminTenantValidator = [
    body('name').notEmpty().withMessage('name is required.').trim(),
    body('slug').notEmpty().withMessage('slug is required.').trim(),
    body('parentId').optional({ nullable: true }).isUUID().withMessage('parentId must be a valid UUID.'),
    body('subStatus')
        .optional()
        .isIn(['TRIAL', 'ACTIVE'])
        .withMessage('subStatus must be one of TRIAL, ACTIVE.'),
    body().custom((value) => {
        const isOrg = !value?.parentId;
        const subStatus = value?.subStatus;
        if (isOrg && subStatus && subStatus !== 'ACTIVE') {
            throw new Error('Organizations must be created with ACTIVE subStatus.');
        }
        if (!isOrg) {
            if (!subStatus) throw new Error('subStatus is required for hotel creation.');
        }
        return true;
    }),
    body('planType').optional().isIn(['BASIC', 'PRO', 'ENTERPRISE', 'CUSTOM']).withMessage('Invalid planType.'),
    body('hasBranches').optional().isBoolean().withMessage('hasBranches must be boolean.'),
    body('maxBranches').optional().isInt({ min: 0 }).withMessage('maxBranches must be a non-negative integer.'),
    body('licenseStartDate').optional().isISO8601().withMessage('licenseStartDate must be a valid ISO date.'),
    body('licenseEndDate').optional({ nullable: true }).isISO8601().withMessage('licenseEndDate must be a valid ISO date.'),
    body('maxUsers').optional().isInt({ min: 1 }).withMessage('maxUsers must be a positive integer.'),
    body('adminEmail').optional().isEmail().withMessage('adminEmail must be a valid email.').normalizeEmail(),
    body('adminPassword').optional().isLength({ min: 8 }).withMessage('adminPassword must be at least 8 characters.'),
    // Wizard / nested shape (alternative to flat adminEmail / adminPassword)
    body('adminUser.email').optional().isEmail().withMessage('adminUser.email must be a valid email.').normalizeEmail(),
    body('adminUser.password').optional().isLength({ min: 8 }).withMessage('adminUser.password must be at least 8 characters.'),
    body('adminUser.firstName').optional().notEmpty().trim(),
    body('adminUser.lastName').optional().notEmpty().trim(),
    validate,
];

const createFullOrganizationValidator = [
    // organization
    body('organization.name').notEmpty().withMessage('organization.name is required.').trim(),
    body('organization.slug').notEmpty().withMessage('organization.slug is required.').trim(),
    body('organization.maxBranches').optional().isInt({ min: 0 }).withMessage('organization.maxBranches must be >= 0.'),
    body('organization.email').optional().isEmail().withMessage('organization.email must be a valid email.').normalizeEmail(),
    // admin user
    body('adminUser.email').isEmail().withMessage('adminUser.email is required.').normalizeEmail(),
    body('adminUser.password').isLength({ min: 8 }).withMessage('adminUser.password must be at least 8 characters.'),
    body('adminUser.firstName').optional().notEmpty().trim(),
    body('adminUser.lastName').optional().notEmpty().trim(),
    // first hotel
    body('hotel.name').notEmpty().withMessage('hotel.name is required.').trim(),
    body('hotel.slug').notEmpty().withMessage('hotel.slug is required.').trim(),
    body('hotel.subStatus').optional().isIn(['TRIAL', 'ACTIVE']).withMessage('hotel.subStatus must be TRIAL or ACTIVE.'),
    body('hotel.planType').optional().isIn(['BASIC', 'PRO', 'ENTERPRISE', 'CUSTOM']).withMessage('Invalid hotel.planType.'),
    body('hotel.maxUsers').optional().isInt({ min: 1 }).withMessage('hotel.maxUsers must be a positive integer.'),
    body('hotel.licenseStartDate').optional().isISO8601().withMessage('hotel.licenseStartDate must be a valid ISO date.'),
    body('hotel.licenseEndDate').optional({ nullable: true }).isISO8601().withMessage('hotel.licenseEndDate must be a valid ISO date.'),
    body('hotel.trialDays').optional().isInt({ min: 1, max: 365 }).withMessage('hotel.trialDays must be between 1 and 365.'),
    // Optional: distinct first-hotel admin (defaults to top-level adminUser when omitted)
    body('hotel.adminUser.email').optional().isEmail().withMessage('hotel.adminUser.email must be a valid email.').normalizeEmail(),
    body('hotel.adminUser.password').optional().isLength({ min: 8 }).withMessage('hotel.adminUser.password must be at least 8 characters.'),
    body('hotel.adminUser.firstName').optional().notEmpty().trim(),
    body('hotel.adminUser.lastName').optional().notEmpty().trim(),
    validate,
];

module.exports = {
    validate,
    loginValidator,
    refreshValidator,
    createUserValidator,
    updateUserValidator,
    updateRoleValidator,
    paginationValidator,
    searchExistingUsersValidator,
    createTenantValidator,
    createSuperAdminTenantValidator,
    createFullOrganizationValidator,
};
