const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const notificationService = require('../services/notification.service');
const emailService = require('../services/email.service');
const winston = require('winston');

const prisma = new PrismaClient();
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [new winston.transports.Console()],
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
        logger.error('[CRON] Failed to run Daily Stock Alert check', error);
    }
});

logger.info('[CRON] Scheduler initialized.');
