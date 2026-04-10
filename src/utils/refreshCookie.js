/**
 * HttpOnly refresh-token cookie (optional; body refreshToken still supported).
 */

const REFRESH_TOKEN_COOKIE_NAME = process.env.REFRESH_TOKEN_COOKIE_NAME || 'refreshToken';

const parseRefreshExpiresMs = () => {
    const v = String(process.env.REFRESH_TOKEN_EXPIRES || '7d').trim();
    const match = /^(\d+)([dhms])$/i.exec(v);
    if (!match) return 7 * 24 * 60 * 60 * 1000;
    const n = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    const mult = { d: 86400000, h: 3600000, m: 60000, s: 1000 };
    return n * mult[unit];
};

const cookieBaseOptions = () => {
    const isProd = (process.env.NODE_ENV || 'development') === 'production';
    return {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        path: '/',
        maxAge: parseRefreshExpiresMs(),
    };
};

const setRefreshTokenCookie = (res, refreshToken) => {
    if (!refreshToken) return;
    res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, cookieBaseOptions());
};

const clearRefreshTokenCookie = (res) => {
    const { maxAge, ...rest } = cookieBaseOptions();
    res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, rest);
};

module.exports = {
    REFRESH_TOKEN_COOKIE_NAME,
    setRefreshTokenCookie,
    clearRefreshTokenCookie,
};
