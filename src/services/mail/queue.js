'use strict';

const prisma = require('../../config/database');
const logger = require('../../utils/logger');
const {
    getTransporter,
    getFromAddress,
    notificationsEnabled,
} = require('./transporter');
const { getMaxAttempts, computeBackoffMs } = require('./mail.service');

const BATCH_LIMIT = 50;

/**
 * Re-drive PENDING EmailLog rows whose nextRetryAt has passed. Called by the
 * cron registered in src/utils/scheduler.js (every 2 minutes).
 *
 * Each row is retried in isolation; per-row failures never abort the batch.
 */
const processMailQueue = async () => {
    if (!notificationsEnabled()) return { picked: 0, sent: 0, failed: 0 };

    const transporter = getTransporter();
    if (!transporter) {
        // SMTP still not configured — leave rows PENDING, don't thrash.
        return { picked: 0, sent: 0, failed: 0, skipped: 'SMTP_NOT_CONFIGURED' };
    }

    const maxAttempts = getMaxAttempts();
    const now = new Date();

    const pending = await prisma.emailLog.findMany({
        where: {
            status: 'PENDING',
            attempts: { lt: maxAttempts },
            OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
        },
        orderBy: { createdAt: 'asc' },
        take: BATCH_LIMIT,
    });

    if (pending.length === 0) return { picked: 0, sent: 0, failed: 0 };

    logger.info(`[mail.queue] processing ${pending.length} pending email(s)`);

    let sent = 0;
    let failed = 0;

    for (const row of pending) {
        try {
            const info = await transporter.sendMail({
                from: getFromAddress(),
                to: row.to,
                cc: row.cc || undefined,
                subject: row.subject,
                html: row.body,
                text: undefined,
            });

            await prisma.emailLog.update({
                where: { id: row.id },
                data: {
                    status: 'SENT',
                    attempts: { increment: 1 },
                    sentAt: new Date(),
                    lastError: null,
                    nextRetryAt: null,
                },
            });
            sent++;
            logger.info(`[mail.queue] sent log=${row.id} to=${row.to} messageId=${info.messageId}`);
        } catch (err) {
            const attempts = row.attempts + 1;
            const isDead = attempts >= maxAttempts;
            const nextRetryAt = isDead ? null : new Date(Date.now() + computeBackoffMs(attempts));

            await prisma.emailLog.update({
                where: { id: row.id },
                data: {
                    status: isDead ? 'DEAD' : 'PENDING',
                    attempts,
                    lastError: err?.message?.slice(0, 2000) || String(err),
                    nextRetryAt,
                },
            });
            failed++;
            logger.warn(
                `[mail.queue] retry failed log=${row.id} to=${row.to} attempts=${attempts}/${maxAttempts} reason=${err?.message}`
            );
        }
    }

    return { picked: pending.length, sent, failed };
};

module.exports = { processMailQueue };
