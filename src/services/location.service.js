const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Create a new location
 */
const createLocation = async (data, tenantId) => {
    const existing = await prisma.location.findFirst({
        where: { name: data.name, tenantId }
    });

    if (existing) {
        const error = new Error(`Location with name '${data.name}' already exists.`);
        error.statusCode = 400;
        throw error;
    }

    // Validate department if provided
    if (data.departmentId) {
        const dept = await prisma.department.findFirst({ where: { id: data.departmentId, tenantId } });
        if (!dept) { const e = new Error('Department not found'); e.statusCode = 400; throw e; }
    }

    return prisma.location.create({
        data: { ...data, tenantId },
        include: { department: { select: { id: true, name: true, code: true } } },
    });
};

/**
 * Get all locations
 */
const getLocations = async (tenantId, query = {}) => {
    const { skip = 0, take = 100, search, type, isActive, departmentId, categoryId } = query;

    const where = {
        tenantId,
        ...(type && { type }),
        ...(departmentId && { departmentId }),
        ...(isActive !== undefined && { isActive: isActive === 'true' }),
        ...(categoryId && {
            locationCategories: {
                some: { categoryId }
            }
        }),
        ...(search && {
            name: { contains: search, mode: 'insensitive' }
        })
    };

    const [locations, total] = await Promise.all([
        prisma.location.findMany({
            where,
            skip: parseInt(skip),
            take: parseInt(take),
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

    return { locations, total };
};

/**
 * Get location by ID
 */
const getLocationById = async (id, tenantId) => {
    const location = await prisma.location.findFirst({
        where: { id, tenantId },
        include: {
            department: { select: { id: true, name: true, code: true } },
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

    return location;
};

/**
 * Update location details
 */
const updateLocation = async (id, data, tenantId) => {
    await getLocationById(id, tenantId);

    if (data.name) {
        const existing = await prisma.location.findFirst({
            where: {
                name: data.name,
                tenantId,
                id: { not: id }
            }
        });

        if (existing) {
            const error = new Error(`Location with name '${data.name}' already exists.`);
            error.statusCode = 400;
            throw error;
        }
    }

    // Validate department if changing
    if (data.departmentId) {
        const dept = await prisma.department.findFirst({ where: { id: data.departmentId, tenantId } });
        if (!dept) { const e = new Error('Department not found'); e.statusCode = 400; throw e; }
    }

    return prisma.location.update({
        where: { id },
        data,
        include: { department: { select: { id: true, name: true, code: true } } },
    });
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
