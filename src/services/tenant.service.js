const prisma = require('../config/database');
const { hashPassword } = require('../utils/password');
const { assertOrgManagerAssignmentWithinOrgHierarchy } = require('../utils/membershipGuard');
const { activeSeatCountsByTenantIds, countActiveSeats } = require('../utils/tenantMemberActive');

const listTenants = async (query = {}, userContext = null) => {
    const { page = 1, limit = 20, status, search } = query;
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;
    const skip = (pageNum - 1) * limitNum;

    const where = {};
    if (status) {
        where.subStatus = status;
    }
    if (search) {
        where.name = { contains: search, mode: 'insensitive' };
    }

    if (userContext && userContext.role !== 'SUPER_ADMIN') {
        const memberships = await prisma.tenantMember.findMany({
            where: {
                userId: userContext.id,
                isActive: true,
                tenantId: { not: null },
            },
            select: { tenantId: true, role: true },
        });

        const orgTenantIds = memberships
            .filter((membership) => membership.role === 'ORG_MANAGER')
            .map((membership) => membership.tenantId)
            .filter(Boolean);

        let visibleTenantIds = [];
        if (orgTenantIds.length > 0) {
            const childTenants = await prisma.tenant.findMany({
                where: { parentId: { in: orgTenantIds } },
                select: { id: true },
            });

            visibleTenantIds = [
                ...new Set([
                    ...orgTenantIds,
                    ...childTenants.map((tenant) => tenant.id),
                ]),
            ];
        } else {
            visibleTenantIds = memberships
                .filter((membership) => membership.role === 'ADMIN')
                .map((membership) => membership.tenantId)
                .filter(Boolean);
        }

        where.id = { in: visibleTenantIds };
    }

    const [total, tenants] = await Promise.all([
        prisma.tenant.count({ where }),
        prisma.tenant.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take: limitNum,
        }),
    ]);

    const activeSeatMap = await activeSeatCountsByTenantIds(
        prisma,
        tenants.map((tenant) => tenant.id)
    );

    const normalizedTenants = tenants.map((tenant) => ({
        ...tenant,
        usersCount: activeSeatMap.get(tenant.id) ?? 0,
    }));

    return { tenants: normalizedTenants, total, page: pageNum, limit: limitNum };
};

const createTenant = async (data) => {
    // Check if slug or name exists
    const existing = await prisma.tenant.findFirst({
        where: {
            OR: [
                { name: data.name },
                { slug: data.slug }
            ]
        }
    });

    if (existing) {
        throw Object.assign(new Error('Tenant name or slug already exists.'), { statusCode: 400 });
    }

    if (!data.adminUser?.email) {
        throw Object.assign(new Error('adminUser.email is required.'), { statusCode: 400 });
    }

    // Create organization/branch and attach initial memberships in one transaction.
    const result = await prisma.$transaction(async (tx) => {
        const parentId = data.parentId || null;
        let parentOrgManagerIds = [];
        const isBranchCreation = Boolean(parentId);

        if (parentId) {
            const parentTenant = await tx.tenant.findUnique({
                where: { id: parentId },
                select: { id: true },
            });
            if (!parentTenant) {
                throw Object.assign(new Error('Parent organization not found.'), { statusCode: 404 });
            }

            const parentOrgManagers = await tx.tenantMember.findMany({
                where: {
                    tenantId: parentId,
                    role: 'ORG_MANAGER',
                    isActive: true,
                },
                select: { userId: true },
                distinct: ['userId'],
            });

            if (parentOrgManagers.length === 0) {
                throw Object.assign(
                    new Error('Parent organization must have at least one active ORG_MANAGER.'),
                    { statusCode: 400 }
                );
            }

            parentOrgManagerIds = parentOrgManagers.map((manager) => manager.userId);
        }

        if (isBranchCreation) {
            const requiredFields = ['status', 'maxUsers'];
            const missingFields = requiredFields.filter((field) => {
                const value = data[field];
                return value === undefined || value === null || value === '';
            });

            if (missingFields.length > 0) {
                throw Object.assign(
                    new Error(`Missing required fields for branch creation: ${missingFields.join(', ')}`),
                    { statusCode: 400 }
                );
            }
        }

        const isOrgCreation = !parentId;
        const statusValue = data.status ?? data.subStatus;
        const normalizedSubStatus = isOrgCreation ? 'ACTIVE' : (statusValue || 'TRIAL');
        const normalizedAdminStatus = 'ACTIVE';

        let resolvedLicenseEndDate = data.licenseEndDate ? new Date(data.licenseEndDate) : null;
        if (!isOrgCreation && normalizedSubStatus === 'TRIAL') {
            // Hotels only: default trial duration is 14 days if not explicitly provided.
            if (!data.licenseEndDate) {
                resolvedLicenseEndDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
            }
        }

        // Root orgs should allow hotels by default unless explicitly disabled.
        const resolvedHasBranches = isOrgCreation
            ? (data.hasBranches === undefined ? true : Boolean(data.hasBranches))
            : false;
        const resolvedMaxBranches = isOrgCreation ? (Number(data.maxBranches) || 0) : 0;

        const resolvedPlanType = isOrgCreation ? 'BASIC' : (data.planType || 'BASIC');
        const resolvedMaxUsers = isOrgCreation ? 10 : (Number(data.maxUsers) || 10);
        const resolvedLicenseStartDate = isOrgCreation
            ? new Date()
            : (data.licenseStartDate ? new Date(data.licenseStartDate) : new Date());

        const tenant = await tx.tenant.create({
            data: {
                name: data.name,
                slug: data.slug,
                ...(parentId ? { parent: { connect: { id: parentId } } } : {}),
                planType: resolvedPlanType,
                subStatus: normalizedSubStatus,
                adminStatus: normalizedAdminStatus,
                licenseStartDate: resolvedLicenseStartDate,
                licenseEndDate: isOrgCreation ? null : resolvedLicenseEndDate,
                maxUsers: resolvedMaxUsers,
                hasBranches: resolvedHasBranches,
                maxBranches: resolvedMaxBranches,
                isActive: true
            }
        });

        const normalizedEmail = data.adminUser.email.toLowerCase();
        let adminUser = await tx.user.findUnique({ where: { email: normalizedEmail } });
        if (!adminUser) {
            if (!data.adminUser.password || !data.adminUser.firstName || !data.adminUser.lastName) {
                throw Object.assign(
                    new Error('firstName, lastName and password are required when creating a new branch admin user.'),
                    { statusCode: 400 }
                );
            }

            const passwordHash = await hashPassword(data.adminUser.password);
            adminUser = await tx.user.create({
                data: {
                    email: normalizedEmail,
                    passwordHash,
                    firstName: data.adminUser.firstName,
                    lastName: data.adminUser.lastName,
                    phone: data.adminUser.phone || null,
                    isActive: true,
                },
            });
        }

        // Membership Guard: if this user is an ORG_MANAGER for another org,
        // they must not be assigned outside their own org hierarchy.
        await assertOrgManagerAssignmentWithinOrgHierarchy(tx, { userId: adminUser.id, targetTenantId: tenant.id });

        if (!parentId) {
            // Top-level organization creation: initial user is ORG_MANAGER.
            await tx.tenantMember.upsert({
                where: { tenantId_userId: { tenantId: tenant.id, userId: adminUser.id } },
                create: {
                    tenantId: tenant.id,
                    userId: adminUser.id,
                    role: 'ORG_MANAGER',
                    isActive: true,
                },
                update: {
                    role: 'ORG_MANAGER',
                    isActive: true,
                },
            });
        } else {
            // Branch creation:
            // 1) Inherit parent org managers as ORG_MANAGER in this branch for visibility.
            for (const orgManagerUserId of parentOrgManagerIds) {
                await tx.tenantMember.upsert({
                    where: { tenantId_userId: { tenantId: tenant.id, userId: orgManagerUserId } },
                    create: {
                        tenantId: tenant.id,
                        userId: orgManagerUserId,
                        role: 'ORG_MANAGER',
                        isActive: true,
                    },
                    update: {
                        role: 'ORG_MANAGER',
                        isActive: true,
                    },
                });
            }

            // 2) Assign branch admin.
            // If selected admin is already an inherited ORG_MANAGER, keep ORG_MANAGER role
            // (single membership per tenant), while admin permissions are still covered.
            const branchAdminRole = parentOrgManagerIds.includes(adminUser.id) ? 'ORG_MANAGER' : 'ADMIN';
            await tx.tenantMember.upsert({
                where: { tenantId_userId: { tenantId: tenant.id, userId: adminUser.id } },
                create: {
                    tenantId: tenant.id,
                    userId: adminUser.id,
                    role: branchAdminRole,
                    isActive: true,
                },
                update: {
                    role: branchAdminRole,
                    isActive: true,
                },
            });
        }

        return tenant;
    });

    return result;
};

const updateTenantLicense = async (id, data) => {
    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw Object.assign(new Error('Tenant not found.'), { statusCode: 404 });

    const updated = await prisma.tenant.update({
        where: { id },
        data: {
            planType: data.planType !== undefined ? data.planType : tenant.planType,
            subStatus: data.subStatus !== undefined ? data.subStatus : tenant.subStatus,
            maxUsers: data.maxUsers !== undefined ? Number(data.maxUsers) : tenant.maxUsers,
            licenseStartDate: data.licenseStartDate ? new Date(data.licenseStartDate) : tenant.licenseStartDate,
            licenseEndDate: data.licenseEndDate ? new Date(data.licenseEndDate) : tenant.licenseEndDate,
            isActive: data.isActive !== undefined ? data.isActive : tenant.isActive
        }
    });

    return updated;
};

const toggleTenantStatus = async (id) => {
    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw Object.assign(new Error('Tenant not found.'), { statusCode: 404 });

    const updated = await prisma.tenant.update({
        where: { id },
        data: { isActive: !tenant.isActive }
    });

    return updated;
};

/**
 * Suspends a root organization: sets adminStatus to SUSPENDED (operational ban).
 * subStatus (TRIAL/ACTIVE) is the subscription/license label and is intentionally unchanged.
 */
const suspendTenant = async (id) => {
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.findUnique({
            where: { id },
            select: { id: true, parentId: true },
        });
        if (!tenant) throw Object.assign(new Error('Tenant not found.'), { statusCode: 404 });
        if (tenant.parentId) {
            throw Object.assign(new Error('Only root organizations can be suspended.'), { statusCode: 400 });
        }

        const updatedOrg = await tx.tenant.update({
            where: { id },
            data: { adminStatus: 'SUSPENDED' },
        });

        const children = await tx.tenant.findMany({
            where: { parentId: id },
            select: { id: true },
        });

        const tenantIds = [id, ...children.map((c) => c.id)];

        const members = await tx.tenantMember.findMany({
            where: {
                tenantId: { in: tenantIds },
                isActive: true,
                user: { isActive: true },
            },
            select: { userId: true },
            distinct: ['userId'],
        });

        const userIds = members.map((m) => m.userId);
        if (userIds.length > 0) {
            await tx.refreshToken.updateMany({
                where: { userId: { in: userIds }, revokedAt: null },
                data: { revokedAt: now },
            });
        }

        return updatedOrg;
    });

    return result;
};

const getTenantById = async (id) => {
    const tenant = await prisma.tenant.findUnique({
        where: { id },
    });
    if (!tenant) throw Object.assign(new Error('Tenant not found.'), { statusCode: 404 });
    const usersCount = await countActiveSeats(prisma, id);
    return {
        ...tenant,
        usersCount,
    };
};

module.exports = {
    listTenants,
    createTenant,
    updateTenantLicense,
    toggleTenantStatus,
    suspendTenant,
    getTenantById
};
