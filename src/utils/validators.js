const { body, query, param, validationResult } = require('express-validator');
const { REFRESH_TOKEN_COOKIE_NAME } = require('./refreshCookie');

const applyLifetimeSubStatusDefault = (req) => {
    const payload = req.body;
    if (!Object.prototype.hasOwnProperty.call(payload, 'licenseEndDate')) return;
    const led = payload.licenseEndDate;
    if ((led === null || led === '') && !Object.prototype.hasOwnProperty.call(payload, 'subStatus')) {
        req.body.subStatus = 'ACTIVE';
    }
};

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

/** Accept refresh token from JSON body or httpOnly cookie (see refreshCookie). */
const resolveRefreshToken = (req, res, next) => {
    const fromBody = req.body?.refreshToken;
    const fromCookie = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];
    const token =
        (typeof fromBody === 'string' && fromBody.trim()) ||
        (typeof fromCookie === 'string' && fromCookie.trim());
    if (!token) {
        return res.status(400).json({
            success: false,
            message: 'Refresh token is required.',
            errors: [{ field: 'refreshToken', message: 'Provide refresh token in body or cookie.' }],
        });
    }
    req.body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    req.body.refreshToken = token;
    next();
};

const refreshValidator = [resolveRefreshToken];

const changePasswordValidator = [
    body('currentPassword').notEmpty().withMessage('Current password is required.'),
    body('newPassword')
        .isLength({ min: 8 })
        .withMessage('New password must be at least 8 characters.'),
    validate,
];

const forgotPasswordValidator = [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),
    validate,
];

const resetPasswordValidator = [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),
    body('otp')
        .matches(/^\d{6}$/)
        .withMessage('OTP must be a 6-digit code.'),
    body('newPassword')
        .isLength({ min: 8 })
        .withMessage('New password must be at least 8 characters.'),
    validate,
];

// ─── User Validators ───────────────────────────────────────────────────────
const createUserValidator = [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),
    body('password').optional().isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
    body('firstName').optional().notEmpty().trim(),
    body('lastName').optional().notEmpty().trim(),
    body('role')
        .isIn([
            'ADMIN',
            'ORG_MANAGER',
            'STOREKEEPER',
            'DEPT_MANAGER',
            'COST_CONTROL',
            'FINANCE_MANAGER',
            'AUDITOR',
            'SECURITY',
            'GENERAL_MANAGER',
        ])
        .withMessage('Invalid role.'),
    body('departmentId').optional({ nullable: true }).isUUID().withMessage('departmentId must be a valid UUID.'),
    validate,
];

const updateUserValidator = [
    body('firstName').optional().notEmpty().trim(),
    body('lastName').optional().notEmpty().trim(),
    body('currentPassword').optional().isString().withMessage('currentPassword must be a string.'),
    body('password').optional().isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
    body('role')
        .optional()
        .isIn([
            'ADMIN',
            'ORG_MANAGER',
            'STOREKEEPER',
            'DEPT_MANAGER',
            'COST_CONTROL',
            'FINANCE_MANAGER',
            'AUDITOR',
            'SECURITY',
            'GENERAL_MANAGER',
        ])
        .withMessage('Invalid role.'),
    body('isActive').optional().isBoolean(),
    validate,
];

const updateRoleValidator = [
    body('role')
        .isIn([
            'ADMIN',
            'ORG_MANAGER',
            'STOREKEEPER',
            'DEPT_MANAGER',
            'COST_CONTROL',
            'FINANCE_MANAGER',
            'AUDITOR',
            'SECURITY',
            'GENERAL_MANAGER',
        ])
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
    body().custom((value, { req }) => {
        const body = req.body;
        const isOrg = !body?.parentId;
        let requestedSubStatus = body?.status ?? body?.subStatus;
        if (isOrg && requestedSubStatus && requestedSubStatus !== 'ACTIVE') {
            throw new Error('Organizations must be created with ACTIVE status.');
        }
        if (!isOrg) {
            const hasLicenseEndKey = Object.prototype.hasOwnProperty.call(body, 'licenseEndDate');
            if (!requestedSubStatus && !hasLicenseEndKey) {
                throw new Error('status/subStatus or licenseEndDate is required for hotel creation.');
            }
            if (hasLicenseEndKey && !body.subStatus && !body.status) {
                req.body.subStatus = 'ACTIVE';
            }
            requestedSubStatus = body.status ?? body.subStatus;
            if (requestedSubStatus === 'TRIAL') {
                // licenseEndDate will be calculated server-side if omitted
            }
            const mu = body.maxUsers;
            if (mu === undefined || mu === null || mu === '') {
                throw new Error('maxUsers is required for hotel creation.');
            }
        }
        return true;
    }),
    body('maxUsers')
        .optional()
        .isInt({ min: 1 })
        .withMessage('maxUsers must be a positive integer.'),
    body('licenseStartDate')
        .optional({ nullable: true })
        .isISO8601()
        .withMessage('licenseStartDate must be a valid ISO date.'),
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
    body().custom((value, { req }) => {
        const body = req.body;
        const isOrg = !body?.parentId;
        if (isOrg && body.subStatus && body.subStatus !== 'ACTIVE') {
            throw new Error('Organizations must be created with ACTIVE subStatus.');
        }
        if (!isOrg) {
            const hasLicenseEndKey = Object.prototype.hasOwnProperty.call(body, 'licenseEndDate');
            if (!body.subStatus && !hasLicenseEndKey) {
                throw new Error('subStatus or licenseEndDate is required for hotel creation.');
            }
            if (hasLicenseEndKey && !body.subStatus) {
                req.body.subStatus = 'ACTIVE';
            }
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
    body().custom((value, { req }) => {
        const hotelIn = value.hotel || {};
        const hasLicenseKey =
            Object.prototype.hasOwnProperty.call(hotelIn, 'licenseEndDate') ||
            Object.prototype.hasOwnProperty.call(value, 'licenseEndDate');
        const hasExplicitSub =
            (hotelIn.subStatus !== undefined && hotelIn.subStatus !== null && hotelIn.subStatus !== '') ||
            (value.subStatus !== undefined && value.subStatus !== null && value.subStatus !== '');
        if (hasLicenseKey && !hasExplicitSub) {
            req.body.hotel = { ...hotelIn, ...(req.body.hotel || {}), subStatus: 'ACTIVE' };
        }
        return true;
    }),
    validate,
];

const updateTenantLicenseValidator = [
    param('id').isUUID().withMessage('id must be a valid UUID.'),
    body('planType').optional().isIn(['BASIC', 'PRO', 'ENTERPRISE', 'CUSTOM']).withMessage('Invalid planType.'),
    body('subStatus')
        .optional()
        .isIn(['TRIAL', 'ACTIVE', 'EXPIRED'])
        .withMessage('subStatus must be one of TRIAL, ACTIVE, EXPIRED.'),
    body('maxUsers').optional().isInt({ min: 1 }).withMessage('maxUsers must be a positive integer.'),
    body('licenseStartDate')
        .optional({ nullable: true })
        .isISO8601()
        .withMessage('licenseStartDate must be a valid ISO date.'),
    body('licenseEndDate')
        .optional({ nullable: true })
        .isISO8601()
        .withMessage('licenseEndDate must be a valid ISO date.'),
    body('isActive').optional().isBoolean(),
    body().custom((value, { req }) => {
        applyLifetimeSubStatusDefault(req);
        return true;
    }),
    validate,
];

const updateSuperAdminTenantValidator = [
    param('id').isUUID().withMessage('id must be a valid UUID.'),
    body('name').optional().notEmpty().trim(),
    body('phone').optional().trim(),
    body('email').optional({ nullable: true }).isEmail().withMessage('email must be a valid email.').normalizeEmail(),
    body('address').optional({ nullable: true }).trim(),
    body('logoUrl').optional({ nullable: true }).trim(),
    body('planType').optional().isIn(['BASIC', 'PRO', 'ENTERPRISE', 'CUSTOM']).withMessage('Invalid planType.'),
    body('subStatus')
        .optional()
        .isIn(['TRIAL', 'ACTIVE', 'EXPIRED'])
        .withMessage('subStatus must be one of TRIAL, ACTIVE, EXPIRED.'),
    body('maxUsers').optional().isInt({ min: 1 }).withMessage('maxUsers must be a positive integer.'),
    body('licenseStartDate')
        .optional({ nullable: true })
        .isISO8601()
        .withMessage('licenseStartDate must be a valid ISO date.'),
    body('licenseEndDate')
        .optional({ nullable: true })
        .isISO8601()
        .withMessage('licenseEndDate must be a valid ISO date.'),
    body('isActive').optional().isBoolean(),
    body('parentId').optional({ nullable: true }).isUUID().withMessage('parentId must be a valid UUID.'),
    body('hasBranches').optional().isBoolean(),
    body('maxBranches').optional().isInt({ min: 0 }).withMessage('maxBranches must be a non-negative integer.'),
    body().custom((value, { req }) => {
        applyLifetimeSubStatusDefault(req);
        return true;
    }),
    validate,
];

/** Super Admin: PATCH-style update for a tenant’s ADMIN / ORG_MANAGER user */
const updateSuperAdminTenantAdminValidator = [
    param('id').isUUID().withMessage('id must be a valid UUID.'),
    param('userId').isUUID().withMessage('userId must be a valid UUID.'),
    body('firstName').optional().notEmpty().trim(),
    body('lastName').optional().notEmpty().trim(),
    body('email').optional().isEmail().withMessage('email must be valid.').normalizeEmail(),
    body('isActive').optional().isBoolean().withMessage('isActive must be a boolean.'),
    body('password').optional().isLength({ min: 8 }).withMessage('password must be at least 8 characters.'),
    body().custom((value, { req }) => {
        const keys = ['firstName', 'lastName', 'email', 'isActive', 'password'];
        if (!keys.some((k) => Object.prototype.hasOwnProperty.call(req.body, k))) {
            throw new Error('At least one of firstName, lastName, email, isActive, or password is required.');
        }
        return true;
    }),
    validate,
];

const updateOrganizationValidator = [
    param('id').isUUID().withMessage('id must be a valid UUID.'),
    body('organization.name').optional().notEmpty().trim(),
    body('organization.slug').optional().notEmpty().trim(),
    body('organization.maxBranches').optional().isInt({ min: 0 }).withMessage('organization.maxBranches must be >= 0.'),
    body('manager.firstName').optional().notEmpty().trim(),
    body('manager.lastName').optional().notEmpty().trim(),
    body('manager.email').optional().isEmail().withMessage('manager.email must be a valid email.').normalizeEmail(),
    body('manager.password').optional().isLength({ min: 8 }).withMessage('manager.password must be at least 8 characters.'),
    body('adminUser.firstName').optional().notEmpty().trim(),
    body('adminUser.lastName').optional().notEmpty().trim(),
    body('adminUser.email').optional().isEmail().withMessage('adminUser.email must be a valid email.').normalizeEmail(),
    body('adminUser.password').optional().isLength({ min: 8 }).withMessage('adminUser.password must be at least 8 characters.'),
    body().custom((value) => {
        const org = value.organization || {};
        const mgr = { ...(value.adminUser || {}), ...(value.manager || {}) };
        const orgHas = ['name', 'slug', 'maxBranches'].some((k) =>
            Object.prototype.hasOwnProperty.call(org, k)
        );
        const mgrHas = ['firstName', 'lastName', 'email', 'password'].some((k) =>
            Object.prototype.hasOwnProperty.call(mgr, k)
        );
        if (!orgHas && !mgrHas) {
            throw new Error('Provide at least one field under organization and/or manager (or adminUser).');
        }
        return true;
    }),
    validate,
];

module.exports = {
    validate,
    loginValidator,
    refreshValidator,
    changePasswordValidator,
    forgotPasswordValidator,
    resetPasswordValidator,
    createUserValidator,
    updateUserValidator,
    updateRoleValidator,
    paginationValidator,
    searchExistingUsersValidator,
    createTenantValidator,
    createSuperAdminTenantValidator,
    createFullOrganizationValidator,
    updateTenantLicenseValidator,
    updateSuperAdminTenantValidator,
    updateSuperAdminTenantAdminValidator,
    updateOrganizationValidator,
};
