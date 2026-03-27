/**
 * Standard API response helpers
 */
const success = (res, data, message = 'Success', statusCode = 200, meta = null) => {
    const body = { success: true, message, data };
    if (meta) body.meta = meta;
    return res.status(statusCode).json(body);
};

const created = (res, data, message = 'Created successfully') => {
    return success(res, data, message, 201);
};

const error = (res, message, statusCode = 400, errors = null) => {
    const response = { success: false, message };
    if (errors) response.errors = errors;
    return res.status(statusCode).json(response);
};

const paginated = (res, data, meta) => {
    return res.status(200).json({
        success: true,
        data,
        meta: {
            page: meta.page,
            limit: meta.limit,
            total: meta.total,
            totalPages: Math.ceil(meta.total / meta.limit),
        },
    });
};

module.exports = { success, created, error, paginated };
