const authService = require('../services/auth.service');
const auditService = require('../services/audit.service');
const { success } = require('../utils/response');

/**
 * M01 — Auth Controller
 */

/**
 * POST /api/auth/login
 */
const login = async (req, res) => {
    const { email, password, tenantSlug } = req.body;

    const result = await authService.login({
        email,
        password,
        tenantSlug,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
    });

    if (result.requiresTenantSelection) {
        return res.status(200).json(result);
    }

    // Audit only when a real tenant/super-admin session was issued.
    await auditService.log({
        tenantId: result.user.tenantId,
        entityType: 'USER',
        entityId: result.user.id,
        action: 'LOGIN',
        changedBy: result.user.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
    });

    return success(res, result, 'Login successful.');
};

/**
 * POST /api/auth/refresh
 */
const refresh = async (req, res) => {
    const { refreshToken } = req.body;
    const result = await authService.refresh(refreshToken);
    return success(res, result, 'Token refreshed.');
};

/**
 * POST /api/auth/logout
 */
const logout = async (req, res) => {
    const { refreshToken } = req.body;
    await authService.logout(refreshToken);

    // Audit logout
    if (req.user) {
        await auditService.log({
            tenantId: req.user.tenantId,
            entityType: 'USER',
            entityId: req.user.id,
            action: 'LOGOUT',
            changedBy: req.user.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }

    return success(res, null, 'Logged out successfully.');
};

/**
 * GET /api/auth/me
 */
const me = async (req, res) => {
    const user = await authService.getMe(req.user.id, req.user.tenantId);
    return success(res, user);
};

/**
 * POST /api/auth/switch-tenant
 */
const switchTenant = async (req, res) => {
    const { tenantSlug } = req.body;

    const result = await authService.switchTenant({
        userId: req.user.id,
        tenantSlug,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
    });

    return success(res, result, 'Tenant switched successfully.');
};

module.exports = { login, refresh, logout, me, switchTenant };
