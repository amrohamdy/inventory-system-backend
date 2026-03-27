const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Create a new supplier
 */
const createSupplier = async (data, tenantId) => {
    // Check unique name for tenant
    const existing = await prisma.supplier.findFirst({
        where: { name: data.name, tenantId }
    });

    if (existing) {
        const error = new Error(`Supplier with name '${data.name}' already exists.`);
        error.statusCode = 400;
        throw error;
    }

    return prisma.supplier.create({
        data: {
            ...data,
            tenantId
        }
    });
};

/**
 * Get all suppliers
 */
const getSuppliers = async (tenantId, query = {}) => {
    const { skip = 0, take = 10, search, isActive } = query;

    const where = {
        tenantId,
        ...(isActive !== undefined && { isActive: isActive === 'true' }),
        ...(search && {
            OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { contactPerson: { contains: search, mode: 'insensitive' } }
            ]
        })
    };

    const [suppliers, total] = await Promise.all([
        prisma.supplier.findMany({
            where,
            skip: parseInt(skip),
            take: parseInt(take),
            orderBy: { name: 'asc' }
        }),
        prisma.supplier.count({ where })
    ]);

    return { suppliers, total };
};

/**
 * Get supplier by ID
 */
const getSupplierById = async (id, tenantId) => {
    const supplier = await prisma.supplier.findFirst({
        where: { id, tenantId }
    });

    if (!supplier) {
        const error = new Error('Supplier not found');
        error.statusCode = 404;
        throw error;
    }

    return supplier;
};

/**
 * Update supplier details
 */
const updateSupplier = async (id, data, tenantId) => {
    await getSupplierById(id, tenantId);

    if (data.name) {
        const existing = await prisma.supplier.findFirst({
            where: {
                name: data.name,
                tenantId,
                id: { not: id }
            }
        });

        if (existing) {
            const error = new Error(`Supplier with name '${data.name}' already exists.`);
            error.statusCode = 400;
            throw error;
        }
    }

    return prisma.supplier.update({
        where: { id },
        data
    });
};

/**
 * Toggle supplier status (Soft Delete concept)
 */
const toggleSupplierStatus = async (id, isActive, tenantId) => {
    await getSupplierById(id, tenantId);
    return prisma.supplier.update({
        where: { id },
        data: { isActive: isActive === 'true' || isActive === true }
    });
};

module.exports = {
    createSupplier,
    getSuppliers,
    getSupplierById,
    updateSupplier,
    toggleSupplierStatus
};
