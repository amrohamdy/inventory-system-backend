/**
 * SaaS Phase 1 — Central Tenant Scope Validation
 *
 * Runs AFTER authenticate on every tenant API request.
 * Ensures:
 *  1. req.user.tenantId exists and is valid
 *  2. Tenant is active
 *  3. Attaches req.tenant for downstream use
 *  4. Updates lastActivityAt in TenantUsage
 */

const prisma = require('../config/database');
const logger = require('../utils/logger');

// Simple tenant cache (5min TTL)
const tenantCache = new Map();
const CACHE_TTL = 300_000; // 5 minutes

const enforcetenantScope = async (req, res, next) => {
    // Skip for SUPER_ADMIN or unauthenticated
    if (!req.user || req.user.role === 'SUPER_ADMIN') return next();

    const { tenantId } = req.user;
    if (!tenantId) {
        return res.status(401).json({
            success: false,
            code: 'MISSING_TENANT',
            message: 'No tenant context. Invalid token.',
        });
    }

    try {
        // Check cache
        let tenant = tenantCache.get(tenantId);
        if (!tenant || Date.now() - tenant._cachedAt > CACHE_TTL) {
            const t = await prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { id: true, name: true, slug: true, isActive: true },
            });
            if (!t) {
                return res.status(401).json({
                    success: false,
                    code: 'INVALID_TENANT',
                    message: 'Tenant not found. Invalid token.',
                });
            }
            tenant = { ...t, _cachedAt: Date.now() };
            tenantCache.set(tenantId, tenant);
        }

        if (!tenant.isActive) {
            return res.status(403).json({
                success: false,
                code: 'TENANT_INACTIVE',
                message: 'Your organization has been deactivated. Please contact support.',
            });
        }

        req.tenant = tenant;

        // Update last activity (fire-and-forget, don't block the request)
        prisma.tenantUsage.updateMany({
            where: { tenantId },
            data: { lastActivityAt: new Date() },
        }).catch(() => { });

        next();
    } catch (err) {
        logger.error(`Tenant scope check failed: ${err.message}`);
        next(err);
    }
};

// Invalidate when tenant status changes
const invalidateTenantCache = (tenantId) => tenantCache.delete(tenantId);

module.exports = { enforcetenantScope, invalidateTenantCache };
