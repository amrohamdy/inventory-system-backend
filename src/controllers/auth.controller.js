const authService = require('../services/auth.service');
const auditService = require('../services/audit.service');
const { success } = require('../utils/response');
const {
    REFRESH_TOKEN_COOKIE_NAME,
    setRefreshTokenCookie,
    clearRefreshTokenCookie,
} = require('../utils/refreshCookie');

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

    if (result.refreshToken) {
        setRefreshTokenCookie(res, result.refreshToken);
    }
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
    const fromBody = req.body?.refreshToken;
    const fromCookie = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];
    const refreshToken =
        (typeof fromBody === 'string' && fromBody.trim()) ||
        (typeof fromCookie === 'string' && fromCookie.trim()) ||
        undefined;
    await authService.logout(refreshToken);
    clearRefreshTokenCookie(res);

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
 * GET /api/profile
 */
const profile = async (req, res) => {
    const data = await authService.getProfile(req.user.id, req.user.tenantId);
    return success(res, data);
};

/**
 * POST /api/auth/change-password
 */
const changePassword = async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    await authService.changePassword({
        userId: req.user.id,
        currentPassword,
        newPassword,
    });
    return success(res, null, 'Password updated successfully.');
};

/**
 * POST /api/auth/forgot-password
 */
const forgotPassword = async (req, res) => {
    const { email } = req.body;
    await authService.requestPasswordReset({ email });
    return success(res, null, 'A reset code has been sent to your email.');
};

/**
 * POST /api/auth/reset-password
 */
const resetPassword = async (req, res) => {
    const { email, otp, newPassword } = req.body;
    await authService.resetPasswordWithOtp({ email, otp, newPassword });
    return success(res, null, 'Password has been reset. You can sign in with your new password.');
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

    if (result.refreshToken) {
        setRefreshTokenCookie(res, result.refreshToken);
    }
    return success(res, result, 'Tenant switched successfully.');
};

module.exports = {
    login,
    refresh,
    logout,
    me,
    profile,
    changePassword,
    forgotPassword,
    resetPassword,
    switchTenant,
};
