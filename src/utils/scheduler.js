const cron = require('node-cron');
const prisma = require('../config/database');
const notificationService = require('../services/notification.service');
const emailService = require('../services/email.service');
const { invalidateTenantCache } = require('../middleware/subscription');
const logger = require('./logger');

// Daily at midnight (server local time): sync subStatus for past-due licenses
cron.schedule('0 0 * * *', async () => {
    logger.info('[CRON] Starting subscription expiration sync...');
    try {
        const now = new Date();
        const due = await prisma.tenant.findMany({
            where: {
                licenseEndDate: { not: null, lt: now },
                subStatus: { not: 'EXPIRED' },
            },
            select: { id: true },
        });
        if (due.length === 0) {
            logger.info('[CRON] Subscription expiration sync: no tenants to update.');
            return;
        }
        await prisma.tenant.updateMany({
            where: { id: { in: due.map((t) => t.id) } },
            data: { subStatus: 'EXPIRED' },
        });
        due.forEach((t) => invalidateTenantCache(t.id));
        logger.info(`[CRON] Subscription expiration sync: marked ${due.length} tenant(s) as EXPIRED.`);
    } catch (error) {
        logger.error('[CRON] Subscription expiration sync failed', { message: error.message, stack: error.stack });
    }
});

// Run every day at 8:00 AM
cron.schedule('0 8 * * *', async () => {
    logger.info('[CRON] Starting Daily Stock Alert check...');
    try {
        // Find active tenant admins
        const tenants = await prisma.tenantMember.findMany({
            where: { role: 'ADMIN', isActive: true, tenantId: { not: null }, user: { isActive: true } },
            select: { tenantId: true, user: { select: { email: true } } },
            distinct: ['tenantId']
        });

        for (const admin of tenants) {
            const tenantId = admin.tenantId;
            const alerts = await notificationService.getLowStockAlerts(tenantId);
            const criticalAlerts = alerts.filter(a => a.severity === 'critical');

            if (criticalAlerts.length > 0) {
                logger.info(`[CRON] Found ${criticalAlerts.length} critical alerts for tenant ${tenantId}. Sending email...`);
                // For a more robust solution, you'd aggregate all admins/purchasing managers for the tenant
                await emailService.sendCriticalStockAlert(criticalAlerts, admin.user.email);
            }
        }
    } catch (error) {
        logger.error('[CRON] Failed to run Daily Stock Alert check', { message: error.message, stack: error.stack });
    }
});

logger.info('[CRON] Scheduler initialized.');
