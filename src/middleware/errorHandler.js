const logger = require('../utils/logger');

/**
 * Global error handler middleware
 * Must be last middleware in the chain (4 params required)
 */
const errorHandler = (err, req, res, next) => {
    logger.error(`${err.name}: ${err.message}`, {
        path: req.path,
        method: req.method,
        tenantId: req.user?.tenantId,
        prismaCode: err.code,
        prismaMeta: err.meta,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });

    // Prisma unique constraint violation
    if (err.code === 'P2002') {
        const target = err.meta?.target;
        const body = {
            success: false,
            message: 'A record with this value already exists.',
            field: target,
        };
        if (Array.isArray(target) && target.includes('slug')) {
            body.code = 'DUPLICATE_TENANT_SLUG';
            body.error = 'DUPLICATE_TENANT_SLUG';
        }
        return res.status(409).json(body);
    }

    // Prisma record not found
    if (err.code === 'P2025') {
        return res.status(404).json({
            success: false,
            message: 'Record not found.',
        });
    }

    // Prisma foreign key constraint
    if (err.code === 'P2003') {
        return res.status(400).json({
            success: false,
            message: 'Referenced record does not exist.',
            field: err.meta?.field_name,
        });
    }

    // Validation error (custom)
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            success: false,
            message: err.message,
            errors: err.errors,
        });
    }

    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({ success: false, message: 'Invalid token.' });
    }

    // Opening Balance phase — explicit response (403 + code for clients)
    if (err.code === 'OPENING_BALANCE_PHASE') {
        return res.status(err.statusCode || 403).json({
            success: false,
            message: err.message,
            code: err.code,
            error: err.code,
        });
    }

    // Default 500
    const statusCode = err.statusCode || err.status || 500;
    const isClientError = statusCode >= 400 && statusCode < 500;
    // In production: 4xx from services use explicit statusCode/status — return err.message (not generic 500 text).
    const exposeMessage =
        process.env.NODE_ENV !== 'production' || isClientError;
    const responseBody = {
        success: false,
        message: exposeMessage ? err.message : 'Internal server error.',
    };

    if (err.code) {
        responseBody.code = err.code;
        responseBody.error = err.code;
    }
    if (err.field !== undefined) responseBody.field = err.field;
    if (err.conflictingSlug !== undefined) responseBody.conflictingSlug = err.conflictingSlug;
    if (err.existingTenantId !== undefined) responseBody.existingTenantId = err.existingTenantId;

    res.status(statusCode).json(responseBody);
};

const notFound = (req, res, next) => {
    res.status(404).json({
        success: false,
        message: `Route not found: ${req.method} ${req.originalUrl}`,
    });
};

module.exports = { errorHandler, notFound };
