const prisma = require('../config/database');
const { hashPassword } = require('../utils/password');
const { assertOrgManagerAssignmentWithinOrgHierarchy } = require('../utils/membershipGuard');
const {
    countActiveSeats,
    assertSingletonRoleAvailable,
} = require('../utils/tenantMemberActive');
const { membershipRoleCode, connectRole } = require('./rbac.service');

/**
 * M01 — User Management Service (Admin operations)
 */

const listUsers = async (tenantId, { page = 1, limit = 20, role, isActive, search } = {}) => {
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;
    const skip = (pageNum - 1) * limitNum;

    const where = {
        tenantId,
        ...(role ? { role: { code: role } } : {}),
        ...(isActive !== undefined ? { isActive: isActive === 'true' } : {}),
        ...(search ? {
            user: {
                OR: [
                    { firstName: { contains: search, mode: 'insensitive' } },
                    { lastName: { contains: search, mode: 'insensitive' } },
                    { email: { contains: search, mode: 'insensitive' } },
                ],
            },
        } : {}),
    };

    const [total, memberships, activeMembersCount, tenant] = await Promise.all([
        prisma.tenantMember.count({ where }),
        prisma.tenantMember.findMany({
            where,
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                        department: true,
                        phone: true,
                        isActive: true,
                        lastLoginAt: true,
                        createdAt: true,
                    },
                },
                department: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                role: true,
            },
            orderBy: [{ role: { code: 'asc' } }, { user: { firstName: 'asc' } }],
            skip,
            take: limitNum,
        }),
        countActiveSeats(prisma, tenantId),
        prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { maxUsers: true },
        }),
    ]);

    const users = memberships.map((membership) => ({
        ...membership.user,
        role: membershipRoleCode(membership),
        departmentId: membership.department?.id || null,
        department: membership.department?.name || membership.user.department || null,
        isActive: membership.isActive && membership.user.isActive,
    }));

    return {
        users,
        total,
        page: pageNum,
        limit: limitNum,
        maxUsers: tenant?.maxUsers ?? 0,
        totalActiveUsers: activeMembersCount,
    };
};

const getAdminTenantIds = async (db, userId) => {
    const adminMemberships = await db.tenantMember.findMany({
        where: {
            userId,
            role: { code: 'ADMIN' },
            isActive: true,
            tenantId: { not: null },
        },
        select: { tenantId: true },
        distinct: ['tenantId'],
    });

    return adminMemberships
        .map((membership) => membership.tenantId)
        .filter(Boolean);
};

const searchExistingUsers = async (requestingUserId, email) => {
    const normalizedEmail = (email || '').trim().toLowerCase();
    if (!normalizedEmail) return [];

    const adminTenantIds = await getAdminTenantIds(prisma, requestingUserId);
    if (adminTenantIds.length === 0) return [];

    const users = await prisma.user.findMany({
        where: {
            email: { contains: normalizedEmail, mode: 'insensitive' },
            memberships: {
                some: {
                    tenantId: { in: adminTenantIds },
                    isActive: true,
                },
            },
        },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
        },
        take: 20,
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { email: 'asc' }],
    });

    return users;
};

const createUser = async (tenantId, data, requestingUserId) => {
    const email = data.email.toLowerCase();

    const user = await prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true, maxUsers: true },
        });
        if (!tenant) {
            throw Object.assign(new Error('Tenant not found.'), { statusCode: 404 });
        }

        let departmentRecord = null;
        if (data.departmentId) {
            departmentRecord = await tx.department.findFirst({
                where: {
                    id: data.departmentId,
                    tenantId,
                    isActive: true,
                },
                select: { id: true, name: true },
            });
            if (!departmentRecord) {
                throw Object.assign(new Error('Invalid department for this tenant.'), { statusCode: 400 });
            }
        }

        let targetUser = await tx.user.findUnique({ where: { email } });

        if (!targetUser) {
            if (!data.password) {
                throw Object.assign(new Error('Password is required for creating a new user.'), { statusCode: 400 });
            }
            if (!data.firstName || !data.lastName) {
                throw Object.assign(new Error('firstName and lastName are required for creating a new user.'), { statusCode: 400 });
            }

            const passwordHash = await hashPassword(data.password);
            targetUser = await tx.user.create({
                data: {
                    email,
                    passwordHash,
                    firstName: data.firstName,
                    lastName: data.lastName,
                    phone: data.phone || null,
                },
            });
        } else {
            // Membership Guard: ORG_MANAGER users cannot be assigned outside their org hierarchy.
            await assertOrgManagerAssignmentWithinOrgHierarchy(tx, { userId: targetUser.id, targetTenantId: tenantId });

            const adminTenantIds = await getAdminTenantIds(tx, requestingUserId);
            if (adminTenantIds.length === 0) {
                throw Object.assign(new Error('You are not authorized to import existing users.'), { statusCode: 403 });
            }

            const sharedMembership = await tx.tenantMember.findFirst({
                where: {
                    userId: targetUser.id,
                    tenantId: { in: adminTenantIds },
                    isActive: true,
                },
                select: { tenantId: true },
            });
            if (!sharedMembership) {
                throw Object.assign(
                    new Error('You can only import users that belong to your managed tenants.'),
                    { statusCode: 403 }
                );
            }
        }

        const existingMembership = await tx.tenantMember.findUnique({
            where: { tenantId_userId: { tenantId, userId: targetUser.id } },
            select: { isActive: true },
        });
        const willConsumeNewSeat = !existingMembership || !existingMembership.isActive;

        if (willConsumeNewSeat) {
            const activeMembersCount = await countActiveSeats(tx, tenantId);
            if (activeMembersCount >= tenant.maxUsers) {
                throw Object.assign(new Error('Maximum user limit reached for this hotel.'), { statusCode: 400 });
            }
        }

        await assertSingletonRoleAvailable(tx, {
            tenantId,
            role: data.role,
            excludeUserId: targetUser.id,
        });

        await tx.tenantMember.upsert({
            where: { tenantId_userId: { tenantId, userId: targetUser.id } },
            create: {
                tenantId,
                userId: targetUser.id,
                role: connectRole(data.role),
                isActive: true,
                departmentId: departmentRecord?.id || null,
            },
            update: {
                role: connectRole(data.role),
                isActive: true,
                departmentId: departmentRecord?.id || null,
            },
        });

        const membership = await tx.tenantMember.findUnique({
            where: { tenantId_userId: { tenantId, userId: targetUser.id } },
            include: {
                user: true,
                department: {
                    select: { id: true, name: true },
                },
                role: true,
            },
        });

        return {
            id: membership.user.id,
            email: membership.user.email,
            firstName: membership.user.firstName,
            lastName: membership.user.lastName,
            role: membershipRoleCode(membership),
            departmentId: membership.department?.id || null,
            department: membership.department?.name || null,
            phone: membership.user.phone,
            isActive: membership.isActive && membership.user.isActive,
            createdAt: membership.user.createdAt,
        };
    });

    return user;
};

const updateUser = async (tenantId, userId, data) => {
    const membership = await prisma.tenantMember.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
        include: { user: true, role: true },
    });
    if (!membership) {
        throw Object.assign(new Error('User not found.'), { statusCode: 404 });
    }

    const updateData = {};
    if (data.firstName) updateData.firstName = data.firstName;
    if (data.lastName) updateData.lastName = data.lastName;
    if (data.department !== undefined) updateData.department = data.department;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.password) updateData.passwordHash = await hashPassword(data.password);

    const updated = await prisma.$transaction(async (tx) => {
        const updatedUser = await tx.user.update({
            where: { id: userId },
            data: updateData,
        });

        let updatedMembership = membership;
        const membershipUpdate = {};
        if (data.isActive !== undefined) membershipUpdate.isActive = data.isActive;
        if (data.role !== undefined) membershipUpdate.role = connectRole(data.role);
        const nextMembershipActive =
            data.isActive !== undefined ? Boolean(data.isActive) : membership.isActive;
        const willBeEffectivelyActive = nextMembershipActive && membership.user.isActive;
        if (data.role !== undefined && willBeEffectivelyActive) {
            await assertSingletonRoleAvailable(tx, {
                tenantId,
                role: data.role,
                excludeUserId: userId,
            });
        }
        if (Object.keys(membershipUpdate).length > 0) {
            updatedMembership = await tx.tenantMember.update({
                where: { tenantId_userId: { tenantId, userId } },
                data: membershipUpdate,
                include: { user: true, role: true },
            });
        }

        return {
            id: updatedUser.id,
            email: updatedUser.email,
            firstName: updatedUser.firstName,
            lastName: updatedUser.lastName,
            role: membershipRoleCode(updatedMembership),
            department: updatedUser.department,
            phone: updatedUser.phone,
            isActive: updatedMembership.isActive && updatedUser.isActive,
            updatedAt: updatedUser.updatedAt,
        };
    });

    return updated;
};

const updateUserRole = async (tenantId, userId, role, requestingUserId) => {
    // Prevent self role change
    if (userId === requestingUserId) {
        throw Object.assign(new Error('You cannot change your own role.'), { statusCode: 400 });
    }

    const membership = await prisma.tenantMember.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
        include: { user: { select: { isActive: true } } },
    });
    if (!membership) {
        throw Object.assign(new Error('User not found.'), { statusCode: 404 });
    }

    if (membership.isActive && membership.user.isActive) {
        await assertSingletonRoleAvailable(prisma, {
            tenantId,
            role,
            excludeUserId: userId,
        });
    }

    const updated = await prisma.$transaction(async (tx) => {
        const m = await tx.tenantMember.update({
            where: { tenantId_userId: { tenantId, userId } },
            data: { role: connectRole(role) },
            include: { user: true, role: true },
        });
        await tx.user.update({
            where: { id: userId },
            data: { permissionVersion: { increment: 1 } },
        });
        return m;
    });

    return {
        id: updated.user.id,
        email: updated.user.email,
        firstName: updated.user.firstName,
        lastName: updated.user.lastName,
        role: membershipRoleCode(updated),
    };
};

const getUserById = async (tenantId, userId) => {
    const membership = await prisma.tenantMember.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
        include: {
            department: { select: { id: true, name: true } },
            role: true,
            user: {
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    department: true,
                    phone: true,
                    isActive: true,
                    lastLoginAt: true,
                    createdAt: true,
                    locationUsers: {
                        include: { location: { select: { id: true, name: true, type: true } } },
                    },
                },
            },
        },
    });

    if (!membership) {
        throw Object.assign(new Error('User not found.'), { statusCode: 404 });
    }

    return {
        ...membership.user,
        role: membershipRoleCode(membership),
        departmentId: membership.department?.id || null,
        department: membership.department?.name || membership.user.department || null,
        isActive: membership.isActive && membership.user.isActive,
    };
};

module.exports = { listUsers, searchExistingUsers, createUser, updateUser, updateUserRole, getUserById };
