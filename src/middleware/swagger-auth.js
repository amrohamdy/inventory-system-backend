'use strict';

/**
 * Gate for /api-docs and /api-docs.json.
 *
 * Behaviour:
 *  - dev (NODE_ENV !== 'production')
 *      → open access, no credentials required (so the team can hit the
 *        Swagger UI while coding without juggling passwords).
 *  - production
 *      → if SWAGGER_USER + SWAGGER_PASS are set, require HTTP Basic auth
 *        against those values
 *      → if either var is missing, respond 404 so the docs endpoint is
 *        invisible (no probing, no info leak about the API surface)
 */

const safeEqual = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return mismatch === 0;
};

const swaggerAuth = (req, res, next) => {
    const isProduction = process.env.NODE_ENV === 'production';
    const user = process.env.SWAGGER_USER;
    const pass = process.env.SWAGGER_PASS;

    if (!isProduction) return next();

    if (!user || !pass) {
        // Production without configured credentials → pretend docs don't exist.
        return res.status(404).send('Not found');
    }

    const header = req.headers.authorization;
    if (!header || !header.startsWith('Basic ')) {
        res.set('WWW-Authenticate', 'Basic realm="API Docs"');
        return res.status(401).send('Authentication required');
    }

    let decoded;
    try {
        decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    } catch {
        res.set('WWW-Authenticate', 'Basic realm="API Docs"');
        return res.status(401).send('Invalid credentials');
    }

    const idx = decoded.indexOf(':');
    const providedUser = idx >= 0 ? decoded.slice(0, idx) : '';
    const providedPass = idx >= 0 ? decoded.slice(idx + 1) : '';

    if (!safeEqual(providedUser, user) || !safeEqual(providedPass, pass)) {
        res.set('WWW-Authenticate', 'Basic realm="API Docs"');
        return res.status(401).send('Invalid credentials');
    }

    next();
};

module.exports = { swaggerAuth };
