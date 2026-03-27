const prisma = require('../config/database');

const createDepartment = async (data, tenantId) => {
    const [dupName, dupCode] = await Promise.all([
        prisma.department.findFirst({ where: { name: data.name, tenantId } }),
        prisma.department.findFirst({ where: { code: data.code, tenantId } }),
    ]);
    if (dupName) { const e = new Error('Department name already exists.'); e.statusCode = 400; throw e; }
    if (dupCode) { const e = new Error('Department code already exists.'); e.statusCode = 400; throw e; }

    return prisma.department.create({
        data: { name: data.name, code: data.code.toUpperCase(), tenantId },
        include: { _count: { select: { locations: true, items: true } } },
    });
};

const getDepartments = async (tenantId, query = {}) => {
    const { skip = 0, take = 50, search, isActive } = query;
    const where = {
        tenantId,
        ...(isActive !== undefined && { isActive: isActive === 'true' }),
        ...(search && {
            OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { code: { contains: search, mode: 'insensitive' } },
            ]
        }),
    };

    const [departments, total] = await Promise.all([
        prisma.department.findMany({
            where, skip: parseInt(skip), take: parseInt(take),
            orderBy: { name: 'asc' },
            include: {
                _count: { select: { locations: true, items: true } },
                locations: { select: { id: true, name: true, type: true, isActive: true } },
            },
        }),
        prisma.department.count({ where }),
    ]);
    return { departments, total };
};

const getDepartmentById = async (id, tenantId) => {
    const dept = await prisma.department.findFirst({
        where: { id, tenantId },
        include: {
            _count: { select: { locations: true, items: true } },
            locations: { select: { id: true, name: true, type: true, isActive: true } },
        },
    });
    if (!dept) { const e = new Error('Department not found'); e.statusCode = 404; throw e; }
    return dept;
};

const updateDepartment = async (id, data, tenantId) => {
    await getDepartmentById(id, tenantId);

    if (data.name) {
        const dup = await prisma.department.findFirst({ where: { name: data.name, tenantId, id: { not: id } } });
        if (dup) { const e = new Error('Department name already exists.'); e.statusCode = 400; throw e; }
    }
    if (data.code) {
        const dup = await prisma.department.findFirst({ where: { code: data.code.toUpperCase(), tenantId, id: { not: id } } });
        if (dup) { const e = new Error('Department code already exists.'); e.statusCode = 400; throw e; }
        data.code = data.code.toUpperCase();
    }

    return prisma.department.update({
        where: { id }, data,
        include: { _count: { select: { locations: true, items: true } } },
    });
};

const deleteDepartment = async (id, tenantId) => {
    const dept = await getDepartmentById(id, tenantId);
    if (dept._count.items > 0) { const e = new Error('Cannot delete department with items. Reassign items first.'); e.statusCode = 400; throw e; }
    if (dept._count.locations > 0) { const e = new Error('Cannot delete department with locations. Reassign locations first.'); e.statusCode = 400; throw e; }
    return prisma.department.delete({ where: { id } });
};

const toggleDepartment = async (id, tenantId) => {
    const dept = await getDepartmentById(id, tenantId);
    return prisma.department.update({
        where: { id }, data: { isActive: !dept.isActive },
        include: { _count: { select: { locations: true, items: true } } },
    });
};

module.exports = { createDepartment, getDepartments, getDepartmentById, updateDepartment, deleteDepartment, toggleDepartment };
