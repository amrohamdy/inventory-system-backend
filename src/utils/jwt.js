const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_TOKEN_EXPIRES = process.env.ACCESS_TOKEN_EXPIRES || '15m';
const REFRESH_TOKEN_EXPIRES = process.env.REFRESH_TOKEN_EXPIRES || '7d';

if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
    throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be defined in environment variables');
}

/**
 * Generate JWT access token (short-lived)
 */
const generateAccessToken = (payload) => {
    return jwt.sign(
        {
            userId: payload.userId,
            tenantId: payload.tenantId,
            role: payload.role,
            email: payload.email,
            // SaaS Phase 1: impersonation claims (only included when present)
            ...(payload.readOnly ? { readOnly: true } : {}),
            ...(payload.impersonatedBy ? { impersonatedBy: payload.impersonatedBy } : {}),
        },
        JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRES }
    );
};

/**
 * Generate JWT refresh token (long-lived)
 */
const generateRefreshToken = (payload) => {
    return jwt.sign(
        { userId: payload.userId, tenantId: payload.tenantId },
        JWT_REFRESH_SECRET,
        { expiresIn: REFRESH_TOKEN_EXPIRES }
    );
};

/**
 * Verify refresh token
 */
const verifyRefreshToken = (token) => {
    return jwt.verify(token, JWT_REFRESH_SECRET);
};

/**
 * Parse token expiry to milliseconds for DB storage
 */
const getRefreshTokenExpiry = () => {
    const days = parseInt(REFRESH_TOKEN_EXPIRES) || 7;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
};

module.exports = {
    generateAccessToken,
    generateRefreshToken,
    verifyRefreshToken,
    getRefreshTokenExpiry,
};
