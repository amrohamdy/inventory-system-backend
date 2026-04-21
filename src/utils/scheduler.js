const cron = require('node-cron');
const prisma = require('../config/database');
const notificationService = require('../services/notification.service');
const emailService = require('../services/email.service');
const getPassService = require('../services/getPass.service');
const { processMailQueue } = require('../services/mail/queue');
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
            where: { role: { code: 'ADMIN' }, isActive: true, tenantId: { not: null }, user: { isActive: true } },
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

// Every 2 minutes: re-drive any PENDING EmailLog rows whose nextRetryAt has passed.
// Ensures approval/password-reset emails survive transient SMTP outages.
cron.schedule('*/2 * * * *', async () => {
    try {
        const result = await processMailQueue();
        if (result.picked > 0) {
            logger.info(
                `[CRON] mail queue: picked=${result.picked} sent=${result.sent} failed=${result.failed}`
            );
        }
    } catch (error) {
        logger.error('[CRON] mail queue processing failed', {
            message: error.message,
            stack: error.stack,
        });
    }
});

logger.info('[CRON] Scheduler initialized.');

// Run every day at 9:00 AM: mark overdue gate passes and notify cost control users.
cron.schedule('0 9 * * *', async () => {
    logger.info('[CRON] Starting overdue gate pass scan...');
    try {
        const { overdueCount, notifiedCount } = await getPassService.checkAndNotifyOverduePasses({
            notifyCostControl: true,
        });
        logger.info(
            `[CRON] Overdue gate pass scan completed: overdue=${overdueCount}, notified=${notifiedCount}.`
        );
    } catch (error) {
        logger.error('[CRON] Overdue gate pass scan failed', {
            message: error.message,
            stack: error.stack,
        });
    }
});
