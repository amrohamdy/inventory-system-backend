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
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });

    // Prisma unique constraint violation
    if (err.code === 'P2002') {
        return res.status(409).json({
            success: false,
            message: 'A record with this value already exists.',
            field: err.meta?.target,
        });
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

    // Default 500
    const statusCode = err.statusCode || 500;
    const responseBody = {
        success: false,
        message: process.env.NODE_ENV === 'production' ? 'Internal server error.' : err.message,
    };

    if (err.code) {
        responseBody.error = err.code;
    }

    res.status(statusCode).json(responseBody);
};

const notFound = (req, res, next) => {
    res.status(404).json({
        success: false,
        message: `Route not found: ${req.method} ${req.originalUrl}`,
    });
};

module.exports = { errorHandler, notFound };
