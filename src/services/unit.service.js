const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Create a new unit of measure
 */
const createUnit = async (data, tenantId) => {
    // Check if abbreviation is unique within the tenant
    const existingByAbbr = await prisma.unit.findFirst({
        where: { abbreviation: data.abbreviation, tenantId }
    });

    if (existingByAbbr) {
        const error = new Error(`Unit with abbreviation '${data.abbreviation}' already exists.`);
        error.statusCode = 400;
        throw error;
    }

    // Check if name is unique within the tenant
    const existingByName = await prisma.unit.findFirst({
        where: { name: data.name, tenantId }
    });

    if (existingByName) {
        const error = new Error(`Unit with name '${data.name}' already exists.`);
        error.statusCode = 400;
        throw error;
    }

    return prisma.unit.create({
        data: {
            ...data,
            tenantId
        }
    });
};

/**
 * Get all units of measure
 */
const getUnits = async (tenantId, query = {}) => {
    // Simple retrieval, usually a small dataset so pagination might not be strictly needed, but added for consistency
    const { skip = 0, take = 50, search, isActive } = query;

    const where = {
        tenantId,
        ...(isActive !== undefined && { isActive: isActive === 'true' }),
        ...(search && {
            OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { abbreviation: { contains: search, mode: 'insensitive' } }
            ]
        })
    };

    const [units, total] = await Promise.all([
        prisma.unit.findMany({
            where,
            skip: parseInt(skip),
            take: parseInt(take),
            orderBy: { name: 'asc' }
        }),
        prisma.unit.count({ where })
    ]);

    return { units, total };
};

/**
 * Get unit by ID
 */
const getUnitById = async (id, tenantId) => {
    const unit = await prisma.unit.findFirst({
        where: { id, tenantId }
    });

    if (!unit) {
        const error = new Error('Unit of measure not found');
        error.statusCode = 404;
        throw error;
    }

    return unit;
};

/**
 * Update unit details
 */
const updateUnit = async (id, data, tenantId) => {
    await getUnitById(id, tenantId);

    // If updating abbreviation, check uniqueness
    if (data.abbreviation) {
        const existingPAbbr = await prisma.unit.findFirst({
            where: {
                abbreviation: data.abbreviation,
                tenantId,
                id: { not: id }
            }
        });

        if (existingPAbbr) {
            const error = new Error(`Unit with abbreviation '${data.abbreviation}' already exists.`);
            error.statusCode = 400;
            throw error;
        }
    }

    // If updating name, check uniqueness
    if (data.name) {
        const existingByName = await prisma.unit.findFirst({
            where: {
                name: data.name,
                tenantId,
                id: { not: id }
            }
        });

        if (existingByName) {
            const error = new Error(`Unit with name '${data.name}' already exists.`);
            error.statusCode = 400;
            throw error;
        }
    }

    return prisma.unit.update({
        where: { id },
        data
    });
};

module.exports = {
    createUnit,
    getUnits,
    getUnitById,
    updateUnit
};
