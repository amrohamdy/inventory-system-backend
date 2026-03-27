/**
 * Map Prisma P2002 (unique constraint) on tenant/user create to API errors.
 * @returns {Error & { statusCode: number } | null}
 */
const mapPrismaTenantUniqueConstraintError = (err) => {
    if (err?.code !== 'P2002') return null;
    const rawTarget = err.meta?.target;
    const fieldStr = Array.isArray(rawTarget) ? rawTarget.join(', ') : String(rawTarget || '');
    if (fieldStr.includes('slug')) {
        return Object.assign(
            new Error('A tenant with this slug already exists. Please choose a different slug.'),
            { statusCode: 409 }
        );
    }
    if (fieldStr.includes('email')) {
        return Object.assign(
            new Error('This email is already registered to another user.'),
            { statusCode: 409 }
        );
    }
    return Object.assign(new Error('A unique constraint was violated. Please check slug and other identifiers.'), {
        statusCode: 409,
    });
};

module.exports = { mapPrismaTenantUniqueConstraintError };
