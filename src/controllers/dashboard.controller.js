const prisma = require('../config/database');
const dashboardService = require('../services/dashboard.service');

/**
 * SUPER_ADMIN: any root org. ORG_MANAGER: must have active ORG_MANAGER membership on parentTenantId (root org only).
 */
const assertCanViewOrganizationSummary = async (req, parentTenantId) => {
    if (req.user.role === 'SUPER_ADMIN') return;

    if (req.user.role !== 'ORG_MANAGER') {
        const err = new Error('Access denied.');
        err.statusCode = 403;
        throw err;
    }

    const parent = await prisma.tenant.findUnique({
        where: { id: parentTenantId },
        select: { id: true, parentId: true },
    });
    if (!parent || parent.parentId !== null) {
        const err = new Error('Invalid parent organization.');
        err.statusCode = 403;
        throw err;
    }

    const membership = await prisma.tenantMember.findFirst({
        where: {
            userId: req.user.id,
            tenantId: parentTenantId,
            role: { code: 'ORG_MANAGER' },
            isActive: true,
        },
    });
    if (!membership) {
        const err = new Error('Access denied. ORG_MANAGER membership on this organization is required.');
        err.statusCode = 403;
        throw err;
    }
};

const getSummary = async (req, res, next) => {
    try {
        const start = Date.now();
        const data = await dashboardService.getDashboardSummary(req.user.tenantId);
        const responseTime = Date.now() - start;
        res.json({ success: true, data, meta: { responseTimeMs: responseTime } });
    } catch (e) { next(e); }
};

const getCharts = async (req, res, next) => {
    try {
        const data = await dashboardService.getChartData(req.user.tenantId);
        res.json({ success: true, data });
    } catch (e) { next(e); }
};

const getOrganizationSummary = async (req, res, next) => {
    try {
        const parentTenantId = req.query.parentTenantId;
        if (!parentTenantId || typeof parentTenantId !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'Query parameter parentTenantId is required.',
            });
        }

        await assertCanViewOrganizationSummary(req, parentTenantId);
        const data = await dashboardService.getOrganizationSummary(parentTenantId);
        res.json({ success: true, data });
    } catch (e) {
        next(e);
    }
};

module.exports = { getSummary, getCharts, getOrganizationSummary };
