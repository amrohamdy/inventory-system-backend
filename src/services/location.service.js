const { PrismaClient } = require('@prisma/client');
const { validate: uuidValidate } = require('uuid');
const prisma = new PrismaClient();

const MAX_LOCATION_PAGE = 1000;
const MAX_LOCATION_SLIM = 5000;

const isSlimQuery = (value) => value === 'true' || value === true;

const parseLocationPagination = (querySkip, queryTake, defaultTake = 100) => {
    let skip = parseInt(querySkip, 10);
    if (!Number.isFinite(skip) || skip < 0) skip = 0;
    let take = parseInt(queryTake, 10);
    if (!Number.isFinite(take) || take < 1) take = defaultTake;
    take = Math.min(take, MAX_LOCATION_PAGE);
    return { skip, take };
};

const assertDepartmentInTenant = async (departmentId, tenantId) => {
    const dept = await prisma.department.findFirst({
        where: { id: departmentId, tenantId },
        select: { id: true },
    });
    if (!dept) {
        const e = new Error('Department not found');
        e.statusCode = 404;
        throw e;
    }
};

const normalizeCategoryIds = (categoryIds) => {
    if (categoryIds === undefined) return undefined;
    if (!Array.isArray(categoryIds)) {
        const error = new Error('categoryIds must be an array of UUID strings');
        error.statusCode = 400;
        throw error;
    }
    return [...new Set(categoryIds.filter(Boolean))];
};

const validateOptionalIsActive = (payload) => {
    if (!Object.prototype.hasOwnProperty.call(payload, 'isActive')) return;
    if (typeof payload.isActive !== 'boolean') {
        const error = new Error('isActive must be a boolean');
        error.statusCode = 400;
        throw error;
    }
};

const validateCategoryIdsBelongToTenant = async (categoryIds, tenantId) => {
    if (!categoryIds || categoryIds.length === 0) return;
    const found = await prisma.category.findMany({
        where: { id: { in: categoryIds }, tenantId },
        select: { id: true },
    });
    if (found.length !== categoryIds.length) {
        const error = new Error('One or more categories not found');
        error.statusCode = 400;
        throw error;
    }
};

const mapLocationWithCategories = (location) => ({
    ...location,
    categories: (location.locationCategories || []).map((row) => row.category),
});

/**
 * Create a new location
 */
const createLocation = async (data, tenantId) => {
    const { categoryIds, ...locationData } = data;
    const normalizedCategoryIds = normalizeCategoryIds(categoryIds);
    validateOptionalIsActive(locationData);

    const existing = await prisma.location.findFirst({
        where: { name: locationData.name, tenantId }
    });

    if (existing) {
        const error = new Error(`Location with name '${locationData.name}' already exists.`);
        error.statusCode = 400;
        throw error;
    }

    // Validate department if provided
    if (locationData.departmentId) {
        const dept = await prisma.department.findFirst({ where: { id: locationData.departmentId, tenantId } });
        if (!dept) { const e = new Error('Department not found'); e.statusCode = 400; throw e; }
    }

    await validateCategoryIdsBelongToTenant(normalizedCategoryIds, tenantId);

    const location = await prisma.location.create({
        data: {
            ...locationData,
            isActive: locationData.isActive ?? true,
            tenantId,
            ...(normalizedCategoryIds !== undefined && {
                locationCategories: {
                    create: normalizedCategoryIds.map((categoryId) => ({
                        category: { connect: { id: categoryId } },
                    })),
                },
            }),
        },
        include: {
            department: { select: { id: true, name: true, code: true } },
            locationCategories: { include: { category: { select: { id: true, name: true } } } },
        },
    });

    return mapLocationWithCategories(location);
};

/**
 * Get all locations
 */
const getLocations = async (tenantId, query = {}) => {
    const { search, type, isActive, departmentId, categoryId, slim } = query;
    const slimMode = isSlimQuery(slim);

    if (departmentId) {
        if (!uuidValidate(departmentId)) {
            const e = new Error('Invalid departmentId');
            e.statusCode = 400;
            throw e;
        }
        await assertDepartmentInTenant(departmentId, tenantId);
    }

    const hasExplicitIsActive = Object.prototype.hasOwnProperty.call(query, 'isActive');

    const where = {
        tenantId,
        ...(type && { type }),
        ...(departmentId && { departmentId }),
        ...(departmentId && !hasExplicitIsActive ? { isActive: true } : {}),
        ...(hasExplicitIsActive ? { isActive: isActive === 'true' } : {}),
        ...(categoryId && {
            locationCategories: {
                some: { categoryId }
            }
        }),
        ...(search && {
            name: { contains: search, mode: 'insensitive' }
        })
    };

    if (slimMode) {
        const locations = await prisma.location.findMany({
            where,
            take: MAX_LOCATION_SLIM,
            orderBy: { name: 'asc' },
            select: { id: true, name: true, type: true },
        });
        return { locations, slim: true };
    }

    const { skip, take } = parseLocationPagination(query.skip, query.take, 100);

    const [locations, total] = await Promise.all([
        prisma.location.findMany({
            where,
            skip,
            take,
            orderBy: { name: 'asc' },
            include: {
                department: { select: { id: true, name: true, code: true } },
                locationCategories: {
                    include: { category: { select: { id: true, name: true } } }
                },
                _count: { select: { locationUsers: true, defaultItems: true } }
            }
        }),
        prisma.location.count({ where })
    ]);

    return { locations: locations.map(mapLocationWithCategories), total, skip, take };
};

/**
 * Get location by ID
 */
const getLocationById = async (id, tenantId) => {
    const location = await prisma.location.findFirst({
        where: { id, tenantId },
        include: {
            department: { select: { id: true, name: true, code: true } },
            locationCategories: {
                include: { category: { select: { id: true, name: true } } }
            },
            locationUsers: {
                include: {
                    user: { select: { id: true, firstName: true, lastName: true, email: true } }
                }
            }
        }
    });

    if (!location) {
        const error = new Error('Location not found');
        error.statusCode = 404;
        throw error;
    }

    return mapLocationWithCategories(location);
};

/**
 * Update location details
 */
const updateLocation = async (id, data, tenantId) => {
    await getLocationById(id, tenantId);
    const { categoryIds, ...locationData } = data;
    const normalizedCategoryIds = normalizeCategoryIds(categoryIds);
    validateOptionalIsActive(locationData);

    if (locationData.name) {
        const existing = await prisma.location.findFirst({
            where: {
                name: locationData.name,
                tenantId,
                id: { not: id }
            }
        });

        if (existing) {
            const error = new Error(`Location with name '${locationData.name}' already exists.`);
            error.statusCode = 400;
            throw error;
        }
    }

    // Validate department if changing
    if (locationData.departmentId) {
        const dept = await prisma.department.findFirst({ where: { id: locationData.departmentId, tenantId } });
        if (!dept) { const e = new Error('Department not found'); e.statusCode = 400; throw e; }
    }

    await validateCategoryIdsBelongToTenant(normalizedCategoryIds, tenantId);

    if (normalizedCategoryIds !== undefined) {
        await prisma.$transaction([
            prisma.location.update({
                where: { id },
                data: locationData,
            }),
            prisma.locationCategory.deleteMany({
                where: { locationId: id },
            }),
            ...(normalizedCategoryIds.length > 0
                ? [
                    prisma.locationCategory.createMany({
                        data: normalizedCategoryIds.map((categoryId) => ({
                            locationId: id,
                            categoryId,
                        })),
                    }),
                ]
                : []),
        ]);
    } else {
        await prisma.location.update({
            where: { id },
            data: locationData,
        });
    }

    const location = await prisma.location.findFirst({
        where: { id, tenantId },
        include: {
            department: { select: { id: true, name: true, code: true } },
            locationCategories: { include: { category: { select: { id: true, name: true } } } },
        },
    });

    if (!location) {
        const error = new Error('Location not found');
        error.statusCode = 404;
        throw error;
    }

    return mapLocationWithCategories(location);
};

/**
 * Assign a user to a location
 */
const assignUserToLocation = async (locationId, userId, tenantId) => {
    // Validate location exists
    await getLocationById(locationId, tenantId);

    // Validate user has active membership in tenant
    const membership = await prisma.tenantMember.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
    });
    if (!membership) {
        const error = new Error('User not found');
        error.statusCode = 404;
        throw error;
    }

    // Check if already assigned
    const existing = await prisma.locationUser.findUnique({
        where: {
            userId_locationId: { userId, locationId }
        }
    });

    if (existing) {
        const error = new Error('User is already assigned to this location');
        error.statusCode = 400;
        throw error;
    }

    return prisma.locationUser.create({
        data: { userId, locationId }
    });
};

/**
 * Remove a user from a location
 */
const removeUserFromLocation = async (locationId, userId, tenantId) => {
    // Validate location exists
    await getLocationById(locationId, tenantId);

    // Note: we might want to check if it exists first to give a better error, 
    // but delete handles missing records if we catch it, or we can just try/catch
    try {
        await prisma.locationUser.delete({
            where: {
                userId_locationId: { userId, locationId }
            }
        });
        return true;
    } catch (error) {
        throw new Error('User assignment not found for this location');
    }
};

/**
 * Delete a location (only if no stock balances exist)
 */
const deleteLocation = async (id, tenantId) => {
    const location = await getLocationById(id, tenantId);

    // Check for stock balances
    const stockCount = await prisma.stockBalance.count({
        where: { locationId: id, tenantId }
    });
    if (stockCount > 0) {
        const error = new Error(`Cannot delete: this location has ${stockCount} stock balance record(s). Remove stock first.`);
        error.statusCode = 400;
        throw error;
    }

    // Check for movement lines
    const movCount = await prisma.movementLine.count({ where: { locationId: id } });
    if (movCount > 0) {
        const error = new Error(`Cannot delete: this location is referenced in ${movCount} movement line(s).`);
        error.statusCode = 400;
        throw error;
    }

    await prisma.locationUser.deleteMany({ where: { locationId: id } });
    await prisma.location.delete({ where: { id } });
    return { deleted: true, name: location.name };
};

/**
 * Get categories linked to a location
 */
const getLocationCategories = async (locationId, tenantId) => {
    await getLocationById(locationId, tenantId); // validates ownership
    const rows = await prisma.locationCategory.findMany({
        where: { locationId },
        include: { category: { select: { id: true, name: true, departmentId: true } } },
    });
    return rows.map(r => r.category);
};

/**
 * Replace the full category list for a location (sync)
 */
const setLocationCategories = async (locationId, categoryIds, tenantId) => {
    await getLocationById(locationId, tenantId); // validates ownership

    // Validate all categories belong to this tenant
    if (categoryIds.length > 0) {
        const found = await prisma.category.findMany({
            where: { id: { in: categoryIds }, tenantId },
            select: { id: true },
        });
        if (found.length !== categoryIds.length) {
            const e = new Error('One or more categories not found'); e.statusCode = 400; throw e;
        }
    }

    await prisma.$transaction([
        prisma.locationCategory.deleteMany({ where: { locationId } }),
        ...categoryIds.map(categoryId =>
            prisma.locationCategory.create({ data: { locationId, categoryId } })
        ),
    ]);

    return getLocationCategories(locationId, tenantId);
};

module.exports = {
    createLocation,
    getLocations,
    getLocationById,
    updateLocation,
    deleteLocation,
    assignUserToLocation,
    removeUserFromLocation,
    getLocationCategories,
    setLocationCategories,
};
