const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ==========================================
// CATEGORIES
// ==========================================

const createCategory = async (data, tenantId) => {
    const existingCategory = await prisma.category.findFirst({
        where: { name: data.name, tenantId },
    });

    if (existingCategory) {
        const error = new Error('Category with this name already exists.');
        error.statusCode = 400;
        throw error;
    }

    return prisma.category.create({
        data: { ...data, tenantId },
    });
};

const getCategories = async (tenantId, query = {}) => {
    const { skip = 0, take = 10, search, isActive, departmentId, departmentIds } = query;

    let dIds = null;
    if (departmentIds) {
        dIds = departmentIds.split(',').map(id => id.trim()).filter(Boolean);
    } else if (departmentId) {
        dIds = [departmentId];
    }

    const where = {
        tenantId,
        ...(isActive !== undefined && { isActive: isActive === 'true' }),
        ...(dIds && dIds.length > 0 && { departmentId: { in: dIds } }),
        ...(search && {
            name: { contains: search, mode: 'insensitive' },
        }),
    };

    const [categories, total] = await Promise.all([
        prisma.category.findMany({
            where,
            skip: parseInt(skip),
            take: parseInt(take),
            orderBy: { name: 'asc' },
            include: {
                department: { select: { id: true, name: true } },
                subcategories: { select: { id: true, name: true, description: true, isActive: true } },
                _count: { select: { items: true, subcategories: true } },
            },
        }),
        prisma.category.count({ where }),
    ]);

    return { categories, total };
};

const getCategoryById = async (id, tenantId) => {
    const category = await prisma.category.findFirst({
        where: { id, tenantId },
        include: {
            subcategories: { select: { id: true, name: true, description: true, isActive: true } }
        }
    });

    if (!category) {
        const error = new Error('Category not found');
        error.statusCode = 404;
        throw error;
    }
    return category;
};

const updateCategory = async (id, data, tenantId) => {
    await getCategoryById(id, tenantId);

    if (data.name) {
        const existingCategory = await prisma.category.findFirst({
            where: { name: data.name, tenantId, id: { not: id } },
        });
        if (existingCategory) {
            const error = new Error('Another category with this name already exists.');
            error.statusCode = 400;
            throw error;
        }
    }

    return prisma.category.update({
        where: { id },
        data,
    });
};

const deleteCategory = async (id, tenantId) => {
    const category = await getCategoryById(id, tenantId);

    if (category.subcategories.length > 0) {
        const error = new Error('Cannot delete category with subcategories. Remove subcategories first.');
        error.statusCode = 400;
        throw error;
    }

    const itemCount = await prisma.item.count({ where: { categoryId: id } });
    if (itemCount > 0) {
        const error = new Error('Cannot delete category containing items. Reassign or delete items first.');
        error.statusCode = 400;
        throw error;
    }

    return prisma.category.delete({ where: { id } });
};

// ==========================================
// SUBCATEGORIES
// ==========================================

const createSubcategory = async (categoryId, data, tenantId) => {
    await getCategoryById(categoryId, tenantId);

    const existing = await prisma.subcategory.findFirst({
        where: { categoryId, name: data.name, tenantId }
    });

    if (existing) {
        const error = new Error(`Subcategory '${data.name}' already exists in this category.`);
        error.statusCode = 400;
        throw error;
    }

    return prisma.subcategory.create({
        data: { ...data, categoryId, tenantId }
    });
};

const updateSubcategory = async (id, data, tenantId) => {
    const subcategory = await prisma.subcategory.findFirst({
        where: { id, tenantId }
    });

    if (!subcategory) {
        const error = new Error('Subcategory not found');
        error.statusCode = 404;
        throw error;
    }

    if (data.name) {
        const existing = await prisma.subcategory.findFirst({
            where: { categoryId: subcategory.categoryId, name: data.name, tenantId, id: { not: id } }
        });
        if (existing) {
            const error = new Error(`Subcategory '${data.name}' already exists.`);
            error.statusCode = 400;
            throw error;
        }
    }

    return prisma.subcategory.update({
        where: { id },
        data
    });
};

const deleteSubcategory = async (id, tenantId) => {
    const subcategory = await prisma.subcategory.findFirst({
        where: { id, tenantId }
    });

    if (!subcategory) {
        const error = new Error('Subcategory not found');
        error.statusCode = 404;
        throw error;
    }

    const itemCount = await prisma.item.count({ where: { subcategoryId: id } });
    if (itemCount > 0) {
        const error = new Error('Cannot delete subcategory containing items.');
        error.statusCode = 400;
        throw error;
    }

    return prisma.subcategory.delete({ where: { id } });
};

module.exports = {
    createCategory,
    getCategories,
    getCategoryById,
    updateCategory,
    deleteCategory,
    createSubcategory,
    updateSubcategory,
    deleteSubcategory
};
