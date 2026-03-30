const jwt = require('jsonwebtoken');
const prisma = require('../config/database');
const logger = require('../utils/logger');
const { membershipRoleCode, getPermissionsForMembership } = require('../services/rbac.service');
const { enforcetenantScope } = require('./tenantScope');
const { enforceSubscription } = require('./subscription');

const getTenantSuspensionFromTokenContext = async (tenantId) => {
    if (!tenantId) return null;

    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
            id: true,
            slug: true,
            isActive: true,
            subStatus: true,
            adminStatus: true,
            parentId: true,
            parent: {
                select: {
                    id: true,
                    isActive: true,
                    subStatus: true,
                    adminStatus: true,
                },
            },
        },
    });

    if (!tenant) return { type: 'INVALID_TENANT', tenant: null };

    // PRIORITY: parent org status takes precedence over child tenant status.
    if (tenant.parent && (tenant.parent.adminStatus === 'SUSPENDED' || tenant.parent.isActive === false)) {
        return { type: 'ORGANIZATION_SUSPENDED', tenant };
    }

    if (tenant.adminStatus === 'SUSPENDED') return { type: 'ACCOUNT_SUSPENDED', tenant };

    return { type: null, tenant };
};

/**
 * M01 — Authentication Middleware (SaaS-enhanced)
 * 1) Verifies JWT access token and attaches user context to req.user
 * 2) Chains tenantScope validation
 * 3) Chains subscription enforcement
 */
const authenticate = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required. Please provide a valid token.',
        });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const userRow = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: { permissionVersion: true },
        });
        if (
            userRow &&
            decoded.permissionVersion !== undefined &&
            userRow.permissionVersion !== decoded.permissionVersion
        ) {
            return res.status(401).json({
                success: false,
                message: 'Session expired. Please login again.',
                code: 'PERMISSIONS_STALE',
            });
        }

        const suspension = await getTenantSuspensionFromTokenContext(decoded.tenantId);
        if (decoded.tenantId && suspension?.tenant) {
            console.log(
                `Auth Check: User [${decoded.email || decoded.userId}] attempting access to Tenant [${suspension.tenant.slug}]. ParentId: [${suspension.tenant.parentId || 'null'}], AdminStatus: [${suspension.tenant.adminStatus}], ParentAdminStatus: [${suspension.tenant.parent?.adminStatus || 'N/A'}], SubStatus: [${suspension.tenant.subStatus}], ParentSubStatus: [${suspension.tenant.parent?.subStatus || 'N/A'}].`
            );
        }
        if (suspension?.type === 'INVALID_TENANT') {
            return res.status(401).json({
                success: false,
                message: 'Invalid token context.',
            });
        }
        if (suspension?.type === 'ACCOUNT_SUSPENDED' || suspension?.type === 'ORGANIZATION_SUSPENDED') {
            return res.status(403).json({
                success: false,
                code: suspension.type,
                message: suspension.type === 'ORGANIZATION_SUSPENDED'
                    ? 'This organization is suspended.'
                    : 'This account is suspended.',
            });
        }

        let membership = await prisma.tenantMember.findFirst({
            where: {
                userId: decoded.userId,
                tenantId: decoded.tenantId || null,
            },
            select: { isActive: true, role: true, roleId: true, tenantId: true },
        });

        // If there is no direct membership for this tenant context, allow ORG_MANAGER
        // inheritance: parent org manager can access child hotels.
        if (!membership && decoded.tenantId) {
            const targetTenant = await prisma.tenant.findUnique({
                where: { id: decoded.tenantId },
                select: { id: true, parentId: true, isActive: true },
            });

            if (!targetTenant || !targetTenant.isActive) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid token context.',
                });
            }

            if (targetTenant.parentId) {
                const parentOrgMembership = await prisma.tenantMember.findFirst({
                    where: {
                        userId: decoded.userId,
                        tenantId: targetTenant.parentId,
                        role: { code: 'ORG_MANAGER' },
                        isActive: true,
                        tenant: { is: { isActive: true, parentId: null } },
                    },
                    select: { isActive: true, role: true, roleId: true, tenantId: true },
                });

                if (parentOrgMembership) {
                    membership = {
                        tenantId: targetTenant.id,
                        role: parentOrgMembership.role,
                        roleId: parentOrgMembership.roleId,
                        isActive: true,
                        isInherited: true,
                    };
                }
            }

            if (!membership) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid token context.',
                });
            }
        }

        if (membership && membership.isActive === false) {
            return res.status(401).json({
                error: 'ACCOUNT_INACTIVE',
                message: 'Your account has been deactivated by the admin.',
            });
        }

        let scopedTenantId = decoded.tenantId;
        const isOrgManager = membership && membershipRoleCode(membership) === 'ORG_MANAGER';
        const requestedTenantIdHeader = typeof req.headers['x-tenant-id'] === 'string'
            ? req.headers['x-tenant-id'].trim()
            : '';

        if (isOrgManager && requestedTenantIdHeader && requestedTenantIdHeader !== decoded.tenantId) {
            const allowedTenant = await prisma.tenant.findFirst({
                where: {
                    id: requestedTenantIdHeader,
                    OR: [
                        { id: decoded.tenantId },
                        { parentId: decoded.tenantId },
                    ],
                },
                select: { id: true },
            });

            if (!allowedTenant) {
                return res.status(403).json({
                    success: false,
                    message: 'ORG_MANAGER can only scope requests to their organization or child hotels.',
                });
            }

            scopedTenantId = allowedTenant.id;
        }

        const roleCode = membership ? membershipRoleCode(membership) : decoded.role;
        let permissions = Array.isArray(decoded.permissions) ? decoded.permissions : [];
        if (permissions.length === 0 && membership) {
            permissions = await getPermissionsForMembership({
                roleId: membership.roleId,
                roleCode,
            });
        }

        req.user = {
            id: decoded.userId,
            tenantId: scopedTenantId,
            role: roleCode,
            roleId: membership?.roleId ?? decoded.roleId,
            permissions,
            email: decoded.email,
            readOnly: decoded.readOnly || false,
            impersonatedBy: decoded.impersonatedBy || null,
        };

        // Chain: authenticate → tenantScope → subscription → next
        enforcetenantScope(req, res, (err) => {
            if (err) return next(err);
            enforceSubscription(req, res, next);
        });
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token expired. Please login again.',
                code: 'TOKEN_EXPIRED',
            });
        }
        logger.warn(`Invalid token attempt: ${err.message}`);
        return res.status(401).json({
            success: false,
            message: 'Invalid token.',
        });
    }
};

module.exports = { authenticate };
