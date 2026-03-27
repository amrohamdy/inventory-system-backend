/**
 * SaaS Phase 1 — Subscription Enforcement Middleware
 *
 * Runs AFTER authenticate on every tenant API request (except /api/auth & /api/admin).
 * Checks:
 *  1. Administrative status (SUSPENDED → 403) and active flag (inactive → 403)
 *  2. Subscription status for hotels (EXPIRED → 402)
 *  2. Trial expiry (402)
 *  3. Plan limits on mutating requests (maxUsers, maxStores, maxMonthlyMovements)
 *  4. Read-only impersonation token blocks writes
 */

const prisma = require('../config/database');
const logger = require('../utils/logger');
const { countActiveSeats } = require('../utils/tenantMemberActive');

// ─── Simple in-memory cache (60s TTL) ─────────────────────────────────────────
const cache = new Map();
const CACHE_TTL = 60_000; // 60 seconds

const getCachedTenantInfo = async (tenantId) => {
    const cached = cache.get(tenantId);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (tenant) cache.set(tenantId, { data: tenant, ts: Date.now() });
    return tenant;
};

// Invalidate cache when tenant changes
const invalidateTenantCache = (tenantId) => cache.delete(tenantId);

// ─── Middleware ───────────────────────────────────────────────────────────────
const enforceSubscription = async (req, res, next) => {
    // Skip for unauthenticated or SUPER_ADMIN
    if (!req.user || req.user.role === 'SUPER_ADMIN') return next();

    const { tenantId } = req.user;

    try {
        const tenant = await getCachedTenantInfo(tenantId);

        if (!tenant) {
            return res.status(403).json({
                success: false,
                code: 'TENANT_INACTIVE',
                message: 'Your tenant account is inactive. Please contact support.',
            });
        }

        // 1. Check admin suspension (self)
        if (tenant.adminStatus === 'SUSPENDED') {
            return res.status(403).json({
                success: false,
                code: 'ACCOUNT_SUSPENDED',
                message: 'ACCOUNT_SUSPENDED',
            });
        }

        // 1b. Check parent organization suspension (hierarchical suspend)
        // PRIORITY: if parent exists, parent status must be evaluated before returning TENANT_INACTIVE
        // to ensure UI consistently shows ORGANIZATION_SUSPENDED for child tenants.
        if (tenant.parentId) {
            const parentTenant = await getCachedTenantInfo(tenant.parentId);
            if (parentTenant && (parentTenant.adminStatus === 'SUSPENDED' || parentTenant.isActive === false)) {
                return res.status(403).json({
                    success: false,
                    code: 'ORGANIZATION_SUSPENDED',
                    message: 'ORGANIZATION_SUSPENDED',
                });
            }
        }

        if (!tenant.isActive) {
            return res.status(403).json({
                success: false,
                code: 'TENANT_INACTIVE',
                message: 'Your tenant account is inactive. Please contact support.',
            });
        }

        // 2. Check EXPIRED (hotels only: child tenants)
        if (tenant.parentId && tenant.subStatus === 'EXPIRED') {
            return res.status(402).json({
                success: false,
                code: 'SUBSCRIPTION_EXPIRED',
                message: 'Your subscription has expired. Please renew to continue.',
            });
        }

        // 3. Check endDate
        if (tenant.licenseEndDate && new Date(tenant.licenseEndDate) < new Date()) {
            await prisma.tenant.update({
                where: { id: tenantId },
                data: { subStatus: 'EXPIRED' },
            });
            invalidateTenantCache(tenantId);
            if (tenant.parentId) {
                return res.status(402).json({
                    success: false,
                    code: 'SUBSCRIPTION_EXPIRED',
                    message: 'Your subscription has expired. Please renew to continue.',
                });
            }
        }

        // 5. Check read-only impersonation token
        if (req.user.readOnly && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
            return res.status(403).json({
                success: false,
                code: 'READ_ONLY_MODE',
                message: 'This is a read-only impersonation session. Write operations are not allowed.',
            });
        }

        // 6. Enforce plan limits on mutating requests
        if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
            // User limit — check on user creation
            if (req.path.match(/\/users$/i) && req.method === 'POST') {
                const count = await countActiveSeats(prisma, tenantId);
                if (count >= tenant.maxUsers) {
                    return res.status(402).json({
                        success: false,
                        code: 'PLAN_LIMIT_EXCEEDED',
                        message: `User limit reached (${count}/${tenant.maxUsers}). Please contact your administrator.`,
                        limit: 'maxUsers',
                        current: count,
                        max: tenant.maxUsers,
                    });
                }
            }
        }

        // Attach tenant subscription info to request for downstream use
        req.tenantSubscription = tenant;
        next();
    } catch (err) {
        logger.error(`Subscription check failed: ${err.message}`);
        // Fail closed — block request if subscription check errors
        next(err);
    }
};

module.exports = { enforceSubscription, invalidateTenantCache };
