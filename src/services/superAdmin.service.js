const prisma = require('../config/database');
const { hashPassword } = require('../utils/password');
const { generateAccessToken } = require('../utils/jwt');
const { invalidateTenantCache } = require('../middleware/subscription');
const logger = require('../utils/logger');
const { assertOrgManagerAssignmentWithinOrgHierarchy } = require('../utils/membershipGuard');
const { activeSeatCountsByTenantIds, countActiveSeats } = require('../utils/tenantMemberActive');
const { mapPrismaTenantUniqueConstraintError } = require('../utils/prismaTenantCreateErrors');
const {
    resolveHotelSubStatusForCreate,
    resolveHotelSubStatusForUpdate,
} = require('../utils/resolveHotelSubStatus');

// ─── Plan Defaults ────────────────────────────────────────────────────────────
const PLAN_DEFAULTS = {
    BASIC: { maxUsers: 5 },
    PRO: { maxUsers: 25 },
    ENTERPRISE: { maxUsers: 99999 },
    CUSTOM: { maxUsers: 10 },
};

const LICENSE_DATE_FORMAT_ERROR = 'Invalid date format provided for License dates.';
const LICENSE_DATE_RANGE_ERROR = 'License end date cannot be before the start date.';

const badRequestError = (message) => Object.assign(new Error(message), { statusCode: 400 });

const parseValidLicenseDate = (value) => {
    const parsedDate = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsedDate.getTime())) {
        throw badRequestError(LICENSE_DATE_FORMAT_ERROR);
    }
    return parsedDate;
};

const validateLicenseDateRange = (startDate, endDate) => {
    if (endDate && endDate < startDate) {
        throw badRequestError(LICENSE_DATE_RANGE_ERROR);
    }
};

const resolveLicenseStartDateForCreate = (licenseStartDate) => {
    if (licenseStartDate === undefined || licenseStartDate === null || licenseStartDate === '') {
        return new Date();
    }
    return parseValidLicenseDate(licenseStartDate);
};

const resolveLicenseStartDateForUpdate = (licenseStartDate) => {
    if (licenseStartDate === null || licenseStartDate === '') {
        throw badRequestError(LICENSE_DATE_FORMAT_ERROR);
    }
    return parseValidLicenseDate(licenseStartDate);
};

const resolveLicenseEndDateForCreate = ({ licenseEndDate, subStatus, trialDays }) => {
    if (licenseEndDate === null || licenseEndDate === '') return null;
    if (licenseEndDate === undefined) {
        if (subStatus === 'TRIAL') {
            return new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);
        }
        return null;
    }
    return parseValidLicenseDate(licenseEndDate);
};

const resolveLicenseEndDateForUpdate = (licenseEndDate) => {
    if (licenseEndDate === null || licenseEndDate === '') return null;
    return parseValidLicenseDate(licenseEndDate);
};

// ─── Admin Audit Helper ───────────────────────────────────────────────────────
const logAdminAction = async (adminUserId, action, targetTenantId, details, ipAddress) => {
    try {
        await prisma.superAdminLog.create({
            data: {
                adminUserId,
                action,
                targetTenantId: targetTenantId || null,
                details: details || null,
                ipAddress: ipAddress || null,
            },
        });
    } catch (err) {
        logger.error(`SuperAdmin audit log failed: ${err.message}`);
    }
};

const getTenantUserIds = async (db, tenantId) => {
    const rows = await db.tenantMember.findMany({
        where: { tenantId, isActive: true },
        select: { userId: true },
        distinct: ['userId'],
    });
    return rows.map((row) => row.userId);
};

// ─── S1.1 — List Tenants (GET /api/super-admin/tenants) ─────────────────────
/** Hierarchical roots + children; includes `adminStatus` for org/branch suspension UI. */
const listTenants = async ({ page = 1, limit = 20, search, status } = {}) => {
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;
    const skip = (pageNum - 1) * limitNum;

    // CRITICAL: super-admin tenant list is hierarchical.
    // Only fetch root organizations and include their direct child hotels.
    const where = { parentId: null };
    if (search) {
        where.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { slug: { contains: search, mode: 'insensitive' } },
        ];
    }
    if (status) {
        where.subStatus = status;
    }

    const countQuery = { where };
    const findManyQuery = {
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
        select: {
            id: true,
            name: true,
            slug: true,
            email: true,
            parentId: true, // always null for roots, included for consistency
            isActive: true,
            planType: true,
            subStatus: true,
            adminStatus: true,
            licenseStartDate: true,
            licenseEndDate: true,
            maxUsers: true,
            hasBranches: true,
            maxBranches: true,
            createdAt: true,
            updatedAt: true,
            _count: { select: { locations: true } },
            children: {
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    name: true,
                    slug: true,
                    email: true,
                    parentId: true,
                    isActive: true,
                    planType: true,
                    subStatus: true,
                    adminStatus: true,
                    licenseStartDate: true,
                    licenseEndDate: true,
                    maxUsers: true,
                    hasBranches: true,
                    maxBranches: true,
                    createdAt: true,
                    updatedAt: true,
                    _count: { select: { locations: true } },
                },
            },
        },
    };

    const [total, roots] = await Promise.all([
        prisma.tenant.count(countQuery),
        prisma.tenant.findMany(findManyQuery),
    ]);

    const tenantIdsForCounts = roots.flatMap((root) => [
        root.id,
        ...(root.children || []).map((child) => child.id),
    ]);
    const activeSeatMap = await activeSeatCountsByTenantIds(prisma, tenantIdsForCounts);

    const toTenantRow = (tenant) => ({
        ...tenant,
        email: tenant.email || null,
        parentName: null,
        usersCount: activeSeatMap.get(tenant.id) ?? 0,
    });

    const rows = roots.map((root) => ({
        ...toTenantRow(root),
        branches: (root.children || []).map(toTenantRow),
    }));

    console.log('[SUPER_ADMIN][listTenants] Prisma where:', JSON.stringify(where));
    console.log('[SUPER_ADMIN][listTenants] Prisma findMany query:', JSON.stringify(findManyQuery));
    console.log('[SUPER_ADMIN][listTenants] Result count:', rows.length, 'Total:', total);

    return { data: rows, total, page: pageNum, limit: limitNum };
};

// ─── S1.2 — Get Tenant Detail ─────────────────────────────────────────────────
const getTenant = async (tenantId) => {
    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: {
            _count: {
                select: { locations: true, movementDocuments: true, items: true },
            },
        },
    });
    if (!tenant) throw Object.assign(new Error('Tenant not found.'), { statusCode: 404 });
    const usersCount = await countActiveSeats(prisma, tenantId);
    return {
        ...tenant,
        usersCount,
    };
};

// ─── S1.3 — Create Tenant ─────────────────────────────────────────────────────
const createTenant = async (data, adminUserId, ipAddress) => {
    const {
        name,
        slug,
        email,
        parentId = null,
        hasBranches = false,
        maxBranches = 0,
        planType = 'BASIC',
        subStatus,
        licenseStartDate,
        licenseEndDate,
        maxUsers,
        // Legacy flat fields (optional if adminUser is nested)
        adminFirstName: flatAdminFirstName,
        adminLastName: flatAdminLastName,
        // Legacy support
        trialDays = 14,
    } = data;

    const nestedAdmin = data.adminUser;
    const adminEmail = nestedAdmin?.email || data.adminEmail;
    const adminPassword = nestedAdmin?.password || data.adminPassword;
    const adminFirstName = nestedAdmin?.firstName || flatAdminFirstName || 'Admin';
    const adminLastName = nestedAdmin?.lastName || flatAdminLastName;

    const existingBySlug = await prisma.tenant.findFirst({ where: { slug }, select: { id: true } });
    if (existingBySlug) {
        throw Object.assign(
            new Error('A tenant with this slug already exists. Please choose a different slug.'),
            { statusCode: 409 }
        );
    }
    const existingByName = await prisma.tenant.findFirst({ where: { name }, select: { id: true } });
    if (existingByName) {
        throw Object.assign(
            new Error('A tenant with this name already exists. Please choose a different name.'),
            { statusCode: 409 }
        );
    }

    const limits = PLAN_DEFAULTS[planType] || PLAN_DEFAULTS.BASIC;
    let resolvedParentId = null;
    // Root orgs should allow hotels by default unless explicitly disabled.
    const defaultHasBranchesForRoot = hasBranches === undefined ? true : Boolean(hasBranches);
    let resolvedHasBranches = defaultHasBranchesForRoot;
    let resolvedMaxBranches = Number(maxBranches) || 0;

    // Parent/child hierarchy rules:
    // - Child tenants inherit strict branch settings (cannot have branches at creation).
    // - Parent tenant must explicitly allow branches and stay under branch limit.
    if (parentId) {
        const parentTenant = await prisma.tenant.findUnique({
            where: { id: parentId },
            select: { id: true, hasBranches: true, maxBranches: true, _count: { select: { children: true } } },
        });

        if (!parentTenant) {
            throw Object.assign(new Error('Parent tenant not found.'), { statusCode: 404 });
        }
        if (!parentTenant.hasBranches) {
            throw Object.assign(
                new Error(
                    'This organization cannot add branches until branching is enabled for the parent organization.'
                ),
                { statusCode: 400 }
            );
        }
        if (parentTenant.maxBranches > 0 && parentTenant._count.children >= parentTenant.maxBranches) {
            throw Object.assign(
                new Error('Maximum number of branches reached for this organization'),
                { statusCode: 400 }
            );
        }

        resolvedParentId = parentTenant.id;
        resolvedHasBranches = false;
        resolvedMaxBranches = 0;
    }

    const isOrgCreation = !resolvedParentId;

    const resolvedSubStatus = isOrgCreation
        ? 'ACTIVE'
        : resolveHotelSubStatusForCreate({ subStatus, licenseEndDate });
    const resolvedAdminStatus = 'ACTIVE';

    // Root org creation: strip/ignore subscription fields entirely.
    const resolvedPlanType = isOrgCreation ? 'BASIC' : planType;
    const resolvedStartDate = isOrgCreation ? new Date() : resolveLicenseStartDateForCreate(licenseStartDate);
    // Lifetime license when null/empty string; trial auto-end-date only when TRIAL.
    const resolvedEndDate = isOrgCreation
        ? null
        : resolveLicenseEndDateForCreate({ licenseEndDate, subStatus: resolvedSubStatus, trialDays });
    const resolvedMaxUsers = isOrgCreation
        ? (PLAN_DEFAULTS.BASIC?.maxUsers ?? 5)
        : (maxUsers !== undefined ? Number(maxUsers) : limits.maxUsers);
    validateLicenseDateRange(resolvedStartDate, resolvedEndDate);

    let tenant;
    try {
        tenant = await prisma.$transaction(async (tx) => {
        // 1. Create Tenant
        const t = await tx.tenant.create({
            data: {
                name,
                slug,
                email: email !== undefined ? email : (adminEmail ? adminEmail.toLowerCase() : null),
                ...(resolvedParentId ? { parent: { connect: { id: resolvedParentId } } } : {}),
                hasBranches: resolvedHasBranches,
                maxBranches: resolvedMaxBranches,
                planType: resolvedPlanType,
                subStatus: resolvedSubStatus,
                adminStatus: resolvedAdminStatus,
                licenseStartDate: resolvedStartDate,
                licenseEndDate: resolvedEndDate,
                maxUsers: resolvedMaxUsers,
                isActive: true,
            },
        });

        // 2. First hotel admin: explicit payload, or inherit from parent org's ORG_MANAGER
        if (adminEmail) {
            const normalizedAdminEmail = adminEmail.toLowerCase();
            let adminUser = await tx.user.findUnique({
                where: { email: normalizedAdminEmail },
            });

            if (!adminUser) {
                if (!adminPassword) {
                    throw Object.assign(
                        new Error('adminPassword is required when assigning a new admin email.'),
                        { statusCode: 400 }
                    );
                }
                const passwordHash = await hashPassword(adminPassword);
                adminUser = await tx.user.create({
                    data: {
                        email: normalizedAdminEmail,
                        passwordHash,
                        firstName: adminFirstName,
                        lastName: adminLastName || name,
                        isActive: true,
                    },
                });
            }

            // Membership Guard: ORG_MANAGER users cannot be assigned outside their org hierarchy.
            await assertOrgManagerAssignmentWithinOrgHierarchy(tx, { userId: adminUser.id, targetTenantId: t.id });

            await tx.tenantMember.upsert({
                where: { tenantId_userId: { tenantId: t.id, userId: adminUser.id } },
                create: {
                    tenantId: t.id,
                    userId: adminUser.id,
                    role: 'ADMIN',
                    isActive: true,
                },
                update: {
                    role: 'ADMIN',
                    isActive: true,
                },
            });
        } else if (resolvedParentId) {
            const orgManagerMembership = await tx.tenantMember.findFirst({
                where: {
                    tenantId: resolvedParentId,
                    role: 'ORG_MANAGER',
                    isActive: true,
                    user: { isActive: true },
                },
                orderBy: { createdAt: 'asc' },
                select: { userId: true },
            });

            if (!orgManagerMembership) {
                throw Object.assign(
                    new Error('No active organization manager found for the parent organization.'),
                    { statusCode: 400 }
                );
            }

            await assertOrgManagerAssignmentWithinOrgHierarchy(tx, {
                userId: orgManagerMembership.userId,
                targetTenantId: t.id,
            });

            await tx.tenantMember.upsert({
                where: {
                    tenantId_userId: { tenantId: t.id, userId: orgManagerMembership.userId },
                },
                create: {
                    tenantId: t.id,
                    userId: orgManagerMembership.userId,
                    role: 'ADMIN',
                    isActive: true,
                },
                update: {
                    role: 'ADMIN',
                    isActive: true,
                },
            });
        }

        return t;
    });
    } catch (err) {
        logger.error('superAdmin.service createTenant: database error', {
            message: err.message,
            prismaCode: err.code,
            prismaMeta: err.meta,
            stack: err.stack,
        });
        const mapped = mapPrismaTenantUniqueConstraintError(err);
        if (mapped) throw mapped;
        throw err;
    }

    await logAdminAction(adminUserId, 'TENANT_CREATED', tenant.id, { name, slug, planType }, ipAddress);
    return tenant;
};

// ─── S1.3b — Create Full Organization (Org + Admin + First Hotel) ─────────────
const createFullOrganization = async (payload, adminUserId, ipAddress) => {
    const org = payload?.organization || payload?.org || payload || {};
    const hotel = payload?.hotel || payload?.firstHotel || payload || {};
    const orgAdminPayload = payload?.adminUser || payload?.admin || {};

    const orgName = org.name ?? payload?.orgName;
    const orgSlug = org.slug ?? payload?.orgSlug;
    const orgEmail = org.email ?? payload?.orgEmail ?? null;
    const maxBranches = org.maxBranches ?? payload?.maxBranches ?? 0;

    const adminEmail = orgAdminPayload.email ?? payload?.adminEmail;
    const adminPassword = orgAdminPayload.password ?? payload?.adminPassword;
    const adminFirstName = orgAdminPayload.firstName ?? payload?.adminFirstName ?? 'Admin';
    const adminLastName = orgAdminPayload.lastName ?? payload?.adminLastName ?? orgName;

    const hotelAdminPayload = hotel.adminUser || orgAdminPayload;

    const hotelName = hotel.name ?? payload?.hotelName ?? payload?.firstHotelName;
    const hotelSlug = hotel.slug ?? payload?.hotelSlug ?? payload?.firstHotelSlug;
    const hotelAdminEmailResolved = hotelAdminPayload.email ?? adminEmail;
    const hotelEmail = hotel.email ?? payload?.hotelEmail ?? (hotelAdminEmailResolved ? String(hotelAdminEmailResolved).toLowerCase() : null);
    const hotelPlanType = hotel.planType ?? payload?.planType ?? 'BASIC';
    const rawHotelSubStatus = hotel.subStatus ?? payload?.subStatus;
    const trialDays = Number(hotel.trialDays ?? payload?.trialDays) || 14;
    const hotelMaxUsers = hotel.maxUsers ?? payload?.maxUsers;
    const hotelLicenseStartDate = hotel.licenseStartDate ?? payload?.licenseStartDate;
    const hotelLicenseEndDate = hotel.licenseEndDate ?? payload?.licenseEndDate;

    if (!orgName || !orgSlug) {
        throw Object.assign(new Error('organization.name and organization.slug are required.'), { statusCode: 400 });
    }
    if (!hotelName || !hotelSlug) {
        throw Object.assign(new Error('hotel.name and hotel.slug are required.'), { statusCode: 400 });
    }
    if (!adminEmail || !adminPassword) {
        throw Object.assign(new Error('adminUser.email and adminUser.password are required.'), { statusCode: 400 });
    }
    // Pre-check uniqueness early for clearer errors.
    const existing = await prisma.tenant.findFirst({
        where: { OR: [{ slug: orgSlug }, { name: orgName }, { slug: hotelSlug }, { name: hotelName }] },
        select: { id: true, slug: true, name: true },
    });
    if (existing) {
        throw Object.assign(new Error('Tenant name or slug already exists.'), { statusCode: 409 });
    }

    const hotelAdminPassword = hotelAdminPayload.password ?? adminPassword;
    const hotelAdminFirstName = hotelAdminPayload.firstName ?? adminFirstName;
    const hotelAdminLastName = hotelAdminPayload.lastName ?? adminLastName ?? hotelName;

    const hotelStartDate = resolveLicenseStartDateForCreate(hotelLicenseStartDate);
    const hotelSubStatus = resolveHotelSubStatusForCreate({
        subStatus: rawHotelSubStatus,
        licenseEndDate: hotelLicenseEndDate,
    });
    const hotelEndDate = resolveLicenseEndDateForCreate({
        licenseEndDate: hotelLicenseEndDate,
        subStatus: hotelSubStatus,
        trialDays,
    });
    validateLicenseDateRange(hotelStartDate, hotelEndDate);

    const created = await prisma.$transaction(async (tx) => {
        const findOrCreateUser = async ({
            email: rawEmail,
            password,
            firstName: fn,
            lastName: ln,
            nameFallback,
        }) => {
            const normalized = String(rawEmail).toLowerCase();
            let u = await tx.user.findUnique({ where: { email: normalized } });
            if (!u) {
                if (!password) {
                    throw Object.assign(
                        new Error('Password is required when creating a new admin user.'),
                        { statusCode: 400 }
                    );
                }
                u = await tx.user.create({
                    data: {
                        email: normalized,
                        passwordHash: await hashPassword(password),
                        firstName: fn || 'Admin',
                        lastName: ln || nameFallback,
                        isActive: true,
                    },
                });
            }
            return u;
        };

        // 1) Create Parent Organization (force hasBranches=true)
        const orgTenant = await tx.tenant.create({
            data: {
                name: orgName,
                slug: orgSlug,
                email: orgEmail,
                hasBranches: true,
                maxBranches: Number(maxBranches) || 0,
                planType: 'BASIC',
                subStatus: 'ACTIVE',
                adminStatus: 'ACTIVE',
                licenseStartDate: new Date(),
                licenseEndDate: null,
                maxUsers: PLAN_DEFAULTS.BASIC?.maxUsers ?? 5,
                isActive: true,
            },
        });

        const normalizedOrgEmail = String(adminEmail).toLowerCase();
        const normalizedHotelEmail = String(hotelAdminEmailResolved).toLowerCase();
        const separateHotelAdmin = normalizedOrgEmail !== normalizedHotelEmail;

        // 2) Organization manager user (always org admin credentials)
        const orgManagerUser = await findOrCreateUser({
            email: adminEmail,
            password: adminPassword,
            firstName: adminFirstName,
            lastName: adminLastName,
            nameFallback: orgName,
        });

        // 3) Create First Hotel linked to Parent ID
        const hotelLimits = PLAN_DEFAULTS[hotelPlanType] || PLAN_DEFAULTS.BASIC;
        const hotelTenant = await tx.tenant.create({
            data: {
                name: hotelName,
                slug: hotelSlug,
                email: hotelEmail,
                parent: { connect: { id: orgTenant.id } },
                hasBranches: false,
                maxBranches: 0,
                planType: hotelPlanType,
                subStatus: hotelSubStatus,
                adminStatus: 'ACTIVE',
                licenseStartDate: hotelStartDate,
                licenseEndDate: hotelEndDate,
                maxUsers: hotelMaxUsers !== undefined ? Number(hotelMaxUsers) : hotelLimits.maxUsers,
                isActive: true,
            },
        });

        // 4) Memberships: org manager on org; hotel admin on hotel (second user when emails differ)
        await tx.tenantMember.upsert({
            where: { tenantId_userId: { tenantId: orgTenant.id, userId: orgManagerUser.id } },
            create: { tenantId: orgTenant.id, userId: orgManagerUser.id, role: 'ORG_MANAGER', isActive: true },
            update: { role: 'ORG_MANAGER', isActive: true },
        });

        if (separateHotelAdmin) {
            const hotelAdminUser = await findOrCreateUser({
                email: hotelAdminEmailResolved,
                password: hotelAdminPassword,
                firstName: hotelAdminFirstName,
                lastName: hotelAdminLastName,
                nameFallback: hotelName,
            });

            await tx.tenantMember.upsert({
                where: { tenantId_userId: { tenantId: hotelTenant.id, userId: hotelAdminUser.id } },
                create: { tenantId: hotelTenant.id, userId: hotelAdminUser.id, role: 'ADMIN', isActive: true },
                update: { role: 'ADMIN', isActive: true },
            });

            return {
                organization: orgTenant,
                hotel: hotelTenant,
                adminUser: orgManagerUser,
                hotelAdminUser,
            };
        }

        await assertOrgManagerAssignmentWithinOrgHierarchy(tx, {
            userId: orgManagerUser.id,
            targetTenantId: hotelTenant.id,
        });

        await tx.tenantMember.upsert({
            where: { tenantId_userId: { tenantId: hotelTenant.id, userId: orgManagerUser.id } },
            create: { tenantId: hotelTenant.id, userId: orgManagerUser.id, role: 'ADMIN', isActive: true },
            update: { role: 'ADMIN', isActive: true },
        });

        return {
            organization: orgTenant,
            hotel: hotelTenant,
            adminUser: orgManagerUser,
            hotelAdminUser: orgManagerUser,
        };
    });

    await logAdminAction(adminUserId, 'TENANT_CREATED', created.organization.id, {
        kind: 'FULL_ORG_SETUP',
        organization: { name: orgName, slug: orgSlug },
        hotel: { name: hotelName, slug: hotelSlug, subStatus: hotelSubStatus },
        maxBranches,
    }, ipAddress);

    return created;
};

/**
 * PATCH organization (root tenant) + its ORG_MANAGER user in one transaction.
 * @param {string} organizationId — root tenant id
 * @param {object} payload — { organization?: { name, slug, maxBranches }, manager?: { firstName, lastName, email, password? }, adminUser?: {...} }
 */
const updateOrganization = async (organizationId, payload, adminUserId, ipAddress) => {
    const orgIn = payload?.organization || {};
    const managerIn = { ...(payload?.adminUser || {}), ...(payload?.manager || {}) };

    const orgPatchKeys = ['name', 'slug', 'maxBranches'].filter((k) =>
        Object.prototype.hasOwnProperty.call(orgIn, k)
    );
    const mgrPatchKeys = ['firstName', 'lastName', 'email', 'password'].filter((k) =>
        Object.prototype.hasOwnProperty.call(managerIn, k)
    );

    if (orgPatchKeys.length === 0 && mgrPatchKeys.length === 0) {
        throw Object.assign(new Error('Provide at least one field under organization or manager.'), { statusCode: 400 });
    }

    const org = await prisma.tenant.findUnique({
        where: { id: organizationId },
        select: {
            id: true,
            parentId: true,
            name: true,
            slug: true,
            maxBranches: true,
        },
    });
    if (!org) {
        throw Object.assign(new Error('Organization not found.'), { statusCode: 404 });
    }
    if (org.parentId !== null) {
        throw Object.assign(new Error('Not a root organization.'), { statusCode: 400 });
    }

    const activeBranchCount = await prisma.tenant.count({
        where: { parentId: organizationId, isActive: true },
    });

    const nextMaxBranches = Object.prototype.hasOwnProperty.call(orgIn, 'maxBranches')
        ? Number(orgIn.maxBranches) || 0
        : org.maxBranches;

    // Align with branch creation: maxBranches > 0 enforces a cap; 0 means no numeric cap.
    if (nextMaxBranches > 0 && nextMaxBranches < activeBranchCount) {
        throw Object.assign(
            new Error(`maxBranches cannot be less than the current number of active branches (${activeBranchCount}).`),
            { statusCode: 400 }
        );
    }

    if (Object.prototype.hasOwnProperty.call(orgIn, 'slug')) {
        const newSlug = String(orgIn.slug).trim();
        if (!newSlug) {
            throw Object.assign(new Error('organization.slug cannot be empty.'), { statusCode: 400 });
        }
        if (newSlug !== org.slug) {
            const slugTaken = await prisma.tenant.findFirst({
                where: { slug: newSlug, NOT: { id: organizationId } },
                select: { id: true },
            });
            if (slugTaken) {
                throw Object.assign(new Error('Organization slug already exists.'), { statusCode: 409 });
            }
        }
    }

    const managerRow = await prisma.tenantMember.findFirst({
        where: { tenantId: organizationId, role: 'ORG_MANAGER', isActive: true },
        orderBy: { createdAt: 'asc' },
        include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
    });
    if (!managerRow?.user) {
        throw Object.assign(new Error('No active organization manager found for this organization.'), { statusCode: 400 });
    }

    const managerUserId = managerRow.user.id;
    let normalizedNewEmail;
    if (Object.prototype.hasOwnProperty.call(managerIn, 'email')) {
        normalizedNewEmail = String(managerIn.email).toLowerCase();
        if (normalizedNewEmail !== managerRow.user.email.toLowerCase()) {
            const emailOwner = await prisma.user.findUnique({
                where: { email: normalizedNewEmail },
                select: { id: true },
            });
            if (emailOwner && emailOwner.id !== managerUserId) {
                throw Object.assign(new Error('Email already in use by another user.'), { statusCode: 409 });
            }
        }
    }

    const tenantData = {};
    if (Object.prototype.hasOwnProperty.call(orgIn, 'name')) {
        const n = String(orgIn.name).trim();
        if (!n) {
            throw Object.assign(new Error('organization.name cannot be empty.'), { statusCode: 400 });
        }
        tenantData.name = n;
    }
    if (Object.prototype.hasOwnProperty.call(orgIn, 'slug')) {
        tenantData.slug = String(orgIn.slug).trim();
    }
    if (Object.prototype.hasOwnProperty.call(orgIn, 'maxBranches')) {
        tenantData.maxBranches = nextMaxBranches;
    }

    const userData = {};
    if (Object.prototype.hasOwnProperty.call(managerIn, 'firstName')) {
        const v = String(managerIn.firstName).trim();
        if (!v) {
            throw Object.assign(new Error('manager.firstName cannot be empty.'), { statusCode: 400 });
        }
        userData.firstName = v;
    }
    if (Object.prototype.hasOwnProperty.call(managerIn, 'lastName')) {
        const v = String(managerIn.lastName).trim();
        if (!v) {
            throw Object.assign(new Error('manager.lastName cannot be empty.'), { statusCode: 400 });
        }
        userData.lastName = v;
    }
    if (normalizedNewEmail !== undefined) {
        userData.email = normalizedNewEmail;
    }

    const hasPasswordPatch = Object.prototype.hasOwnProperty.call(managerIn, 'password');
    if (hasPasswordPatch) {
        const raw = managerIn.password;
        if (raw === null || raw === undefined || String(raw).length === 0) {
            throw Object.assign(new Error('manager.password cannot be empty when provided.'), { statusCode: 400 });
        }
        if (String(raw).length < 8) {
            throw Object.assign(new Error('manager.password must be at least 8 characters.'), { statusCode: 400 });
        }
    }

    await prisma.$transaction(async (tx) => {
        if (Object.keys(tenantData).length > 0) {
            await tx.tenant.update({
                where: { id: organizationId },
                data: tenantData,
            });
        }
        if (hasPasswordPatch) {
            userData.passwordHash = await hashPassword(String(managerIn.password));
        }
        if (Object.keys(userData).length > 0) {
            await tx.user.update({
                where: { id: managerUserId },
                data: userData,
            });
        }
    });

    invalidateTenantCache(organizationId);

    await logAdminAction(adminUserId, 'ORGANIZATION_UPDATED', organizationId, {
        organization: orgPatchKeys.length ? orgIn : undefined,
        manager: mgrPatchKeys.length
            ? {
                ...managerIn,
                password: undefined,
                ...(hasPasswordPatch ? { passwordChanged: true } : {}),
            }
            : undefined,
    }, ipAddress);

    const [updatedOrg, updatedManager] = await Promise.all([
        prisma.tenant.findUnique({
            where: { id: organizationId },
            select: {
                id: true,
                name: true,
                slug: true,
                email: true,
                parentId: true,
                isActive: true,
                planType: true,
                subStatus: true,
                adminStatus: true,
                hasBranches: true,
                maxBranches: true,
                maxUsers: true,
                licenseStartDate: true,
                licenseEndDate: true,
                createdAt: true,
                updatedAt: true,
            },
        }),
        prisma.user.findUnique({
            where: { id: managerUserId },
            select: { id: true, firstName: true, lastName: true, email: true },
        }),
    ]);

    return { ...updatedOrg, manager: updatedManager };
};

// ─── S1.4 — Update Tenant Info ────────────────────────────────────────────────
const updateTenant = async (tenantId, data, adminUserId, ipAddress) => {
    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
            id: true,
            parentId: true,
            hasBranches: true,
            subStatus: true,
            licenseStartDate: true,
            licenseEndDate: true,
            _count: { select: { children: true } },
        },
    });
    if (!tenant) throw Object.assign(new Error('Tenant not found.'), { statusCode: 404 });

    const hasParentIdInPayload = Object.prototype.hasOwnProperty.call(data, 'parentId');
    const hasHasBranchesInPayload = Object.prototype.hasOwnProperty.call(data, 'hasBranches');
    const requestedParentId = hasParentIdInPayload ? (data.parentId || null) : tenant.parentId;
    const isParentChanging = hasParentIdInPayload && requestedParentId !== tenant.parentId;

    // Guardrail: cannot disable branching while children still exist.
    if (hasHasBranchesInPayload && tenant.hasBranches && data.hasBranches === false && tenant._count.children > 0) {
        throw Object.assign(
            new Error('Cannot disable branches for a tenant that already has active branches.'),
            { statusCode: 400 }
        );
    }

    // Re-parenting validations
    if (isParentChanging && requestedParentId) {
        if (requestedParentId === tenantId) {
            throw Object.assign(new Error('A tenant cannot be assigned as its own parent.'), { statusCode: 400 });
        }

        const newParent = await prisma.tenant.findUnique({
            where: { id: requestedParentId },
            select: { id: true, hasBranches: true, maxBranches: true, _count: { select: { children: true } } },
        });
        if (!newParent) {
            throw Object.assign(new Error('Parent tenant not found.'), { statusCode: 404 });
        }
        if (!newParent.hasBranches) {
            throw Object.assign(
                new Error('This parent tenant is not authorized to have branches.'),
                { statusCode: 400 }
            );
        }

        const parentChildCountExcludingThis =
            newParent._count.children - (tenant.parentId === newParent.id ? 1 : 0);
        if (newParent.maxBranches > 0 && parentChildCountExcludingThis >= newParent.maxBranches) {
            throw Object.assign(new Error('Branch limit reached for this parent.'), { statusCode: 400 });
        }

        // Optional circular-reference protection:
        // new parent cannot be any descendant of current tenant.
        let cursor = requestedParentId;
        while (cursor) {
            if (cursor === tenantId) {
                throw Object.assign(
                    new Error('Invalid hierarchy: parent assignment creates a circular reference.'),
                    { statusCode: 400 }
                );
            }
            const node = await prisma.tenant.findUnique({
                where: { id: cursor },
                select: { parentId: true },
            });
            cursor = node?.parentId || null;
        }
    }

    // If moving to a parent (becoming branch), disallow tenants that already have their own branches.
    if (isParentChanging && requestedParentId && tenant._count.children > 0) {
        throw Object.assign(
            new Error('Cannot convert a tenant with active branches into a child branch.'),
            { statusCode: 400 }
        );
    }

    const hasLicenseStartDateInPayload = Object.prototype.hasOwnProperty.call(data, 'licenseStartDate');
    const hasLicenseEndDateInPayload = Object.prototype.hasOwnProperty.call(data, 'licenseEndDate');
    const nextLicenseStartDate = hasLicenseStartDateInPayload
        ? resolveLicenseStartDateForUpdate(data.licenseStartDate)
        : tenant.licenseStartDate;
    const nextLicenseEndDate = hasLicenseEndDateInPayload
        ? resolveLicenseEndDateForUpdate(data.licenseEndDate)
        : tenant.licenseEndDate;
    validateLicenseDateRange(nextLicenseStartDate, nextLicenseEndDate);

    const hasSubStatusInPayload = Object.prototype.hasOwnProperty.call(data, 'subStatus');
    const nextSubStatus = resolveHotelSubStatusForUpdate({
        currentSubStatus: tenant.subStatus,
        payloadSubStatus: data.subStatus,
        hasSubStatusInPayload,
        nextLicenseEndDate: nextLicenseEndDate,
        hasLicenseEndDateInPayload,
    });

    // Normalize hierarchy branch flags:
    // - Child tenant => hasBranches=false, maxBranches=0
    // - Root tenant => can use payload values.
    const updateData = {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.address !== undefined ? { address: data.address } : {}),
        ...(data.logoUrl !== undefined ? { logoUrl: data.logoUrl } : {}),
        // License fields
        ...(data.planType !== undefined ? { planType: data.planType } : {}),
        ...(nextSubStatus !== tenant.subStatus ? { subStatus: nextSubStatus } : {}),
        ...(data.maxUsers !== undefined ? { maxUsers: Number(data.maxUsers) } : {}),
        ...(hasLicenseStartDateInPayload ? { licenseStartDate: nextLicenseStartDate } : {}),
        ...(hasLicenseEndDateInPayload ? { licenseEndDate: nextLicenseEndDate } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(hasParentIdInPayload ? { parentId: requestedParentId } : {}),
    };

    if (requestedParentId) {
        updateData.hasBranches = false;
        updateData.maxBranches = 0;
    } else {
        if (hasHasBranchesInPayload) updateData.hasBranches = Boolean(data.hasBranches);
        if (Object.prototype.hasOwnProperty.call(data, 'maxBranches')) {
            updateData.maxBranches = Number(data.maxBranches) || 0;
        }
    }

    const updated = await prisma.tenant.update({
        where: { id: tenantId },
        data: updateData,
    });

    // Invalidate subscription cache so changes take effect immediately
    invalidateTenantCache(tenantId);

    await logAdminAction(adminUserId, 'TENANT_UPDATED', tenantId, data, ipAddress);
    return updated;
};

// ─── S1.5 — Activate Tenant ──────────────────────────────────────────────────
const activateTenant = async (tenantId, adminUserId, ipAddress) => {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw Object.assign(new Error('Tenant not found.'), { statusCode: 404 });

    const updated = await prisma.tenant.update({
        where: { id: tenantId },
        data: { adminStatus: 'ACTIVE', isActive: true },
    });

    invalidateTenantCache(tenantId);
    await logAdminAction(adminUserId, 'TENANT_ACTIVATED', tenantId, null, ipAddress);
    return updated;
};

// ─── S1.6 — Suspend Tenant ──────────────────────────────────────────────────
const suspendTenant = async (tenantId, adminUserId, ipAddress) => {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw Object.assign(new Error('Tenant not found.'), { statusCode: 404 });

    await prisma.$transaction(async (tx) => {
        // 1. Mark tenant as suspended
        await tx.tenant.update({
            where: { id: tenantId },
            data: { adminStatus: 'SUSPENDED' },
        });

        // 2. Revoke all active refresh tokens for this tenant's users
        const userIds = await getTenantUserIds(tx, tenantId);

        if (userIds.length > 0) {
            await tx.refreshToken.updateMany({
                where: { userId: { in: userIds }, revokedAt: null },
                data: { revokedAt: new Date() },
            });
        }
    });

    invalidateTenantCache(tenantId);
    await logAdminAction(adminUserId, 'TENANT_SUSPENDED', tenantId, null, ipAddress);
};

// ─── S1.7 — Set Subscription / License ─────────────────────────────────────
const setSubscription = async (tenantId, data, adminUserId, ipAddress) => {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw Object.assign(new Error('Tenant not found.'), { statusCode: 404 });

    const { planType, status, endDate, maxUsers } = data;
    const limits = planType ? (PLAN_DEFAULTS[planType] || {}) : {};

    const updated = await prisma.tenant.update({
        where: { id: tenantId },
        data: {
            ...(planType !== undefined ? { planType } : {}),
            ...(status !== undefined ? { subStatus: status } : {}),
            ...(endDate ? { licenseEndDate: new Date(endDate) } : {}),
            ...(maxUsers !== undefined ? { maxUsers: Number(maxUsers) }
                : limits.maxUsers !== undefined ? { maxUsers: limits.maxUsers } : {}),
            isActive: true, // Re-activating on subscription set
        },
    });

    invalidateTenantCache(tenantId);
    await logAdminAction(adminUserId, 'PLAN_CHANGED', tenantId, data, ipAddress);
    return updated;
};

// ─── S1.8 — Force Logout ─────────────────────────────────────────────────────
const forceLogoutTenant = async (tenantId, adminUserId, ipAddress) => {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw Object.assign(new Error('Tenant not found.'), { statusCode: 404 });

    const userIds = await getTenantUserIds(prisma, tenantId);

    let revokedCount = 0;
    if (userIds.length > 0) {
        const result = await prisma.refreshToken.updateMany({
            where: { userId: { in: userIds }, revokedAt: null },
            data: { revokedAt: new Date() },
        });
        revokedCount = result.count;
        logger.info(`Force logout: revoked ${revokedCount} tokens for tenant ${tenantId}`);
    }

    await logAdminAction(
        adminUserId,
        'FORCE_LOGOUT',
        tenantId,
        { revokedTokens: revokedCount },
        ipAddress
    );
};

// ─── S1.9 — Impersonate (Read-only Token) ────────────────────────────────────
const impersonateTenant = async (tenantId, adminUserId, ipAddress) => {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw Object.assign(new Error('Tenant not found.'), { statusCode: 404 });

    // Find first admin user in tenant for the token payload
    const adminMembership = await prisma.tenantMember.findFirst({
        where: { tenantId, role: 'ADMIN', isActive: true, user: { isActive: true } },
        include: { user: true },
    });
    if (!adminMembership) {
        throw Object.assign(
            new Error('No active admin user in target tenant.'),
            { statusCode: 404 }
        );
    }

    const token = generateAccessToken({
        userId: adminMembership.user.id,
        tenantId,
        role: adminMembership.role,
        email: adminMembership.user.email,
        readOnly: true,
        impersonatedBy: adminUserId,
    });

    await logAdminAction(
        adminUserId,
        'IMPERSONATION_STARTED',
        tenantId,
        { asUser: adminMembership.user.email },
        ipAddress
    );

    return {
        token,
        expiresIn: '15m',
        tenant: tenant.name,
        asUser: adminMembership.user.email,
        readOnly: true,
    };
};

// ─── S1.10 — Get Admin Logs ──────────────────────────────────────────────────
const getAdminLogs = async ({ page = 1, limit = 50, targetTenantId, action } = {}) => {
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 50;
    const skip = (pageNum - 1) * limitNum;

    const where = {
        ...(targetTenantId ? { targetTenantId } : {}),
        ...(action ? { action } : {}),
    };

    const [total, logs] = await Promise.all([
        prisma.superAdminLog.count({ where }),
        prisma.superAdminLog.findMany({
            where,
            skip,
            take: limitNum,
            orderBy: { createdAt: 'desc' },
            include: {
                adminUser: {
                    select: { id: true, firstName: true, lastName: true, email: true },
                },
            },
        }),
    ]);

    return { data: logs, total, page: pageNum, limit: limitNum };
};

module.exports = {
    PLAN_DEFAULTS,
    listTenants,
    getTenant,
    createTenant,
    createFullOrganization,
    updateOrganization,
    updateTenant,
    activateTenant,
    suspendTenant,
    setSubscription,
    forceLogoutTenant,
    impersonateTenant,
    getAdminLogs,
};
