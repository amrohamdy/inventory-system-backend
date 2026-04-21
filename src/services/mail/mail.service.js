'use strict';

const prisma = require('../../config/database');
const logger = require('../../utils/logger');
const { render } = require('./templates/loader');
const {
    getTransporter,
    isSmtpConfigured,
    notificationsEnabled,
    getFromAddress,
} = require('./transporter');
const resendProvider = require('./providers/resend.provider');

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_INITIAL_DELAY_SECONDS = 60;

const getMaxAttempts = () => {
    const n = parseInt(process.env.EMAIL_MAX_ATTEMPTS, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_ATTEMPTS;
};

const getInitialDelaySeconds = () => {
    const n = parseInt(process.env.EMAIL_RETRY_INITIAL_DELAY_SECONDS, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_INITIAL_DELAY_SECONDS;
};

/**
 * Exponential backoff: attempts 1→1x, 2→2x, 3→4x, 4→8x (capped).
 * Returns milliseconds to wait before the next attempt.
 */
const computeBackoffMs = (attempts) => {
    const base = getInitialDelaySeconds() * 1000;
    const multiplier = Math.min(2 ** Math.max(0, attempts - 1), 16);
    return base * multiplier;
};

const buildHtmlAndText = ({ template, vars, html, text }) => {
    if (html || text) return { html, text };
    if (!template) {
        throw new Error('mail.sendMail: provide either {template, vars} or {html|text}');
    }
    const rendered = render(template, vars || {});
    return { html: rendered, text: undefined };
};

const attemptTransport = async ({ to, cc, subject, html, text }) => {
    const from = getFromAddress();

    // Resend (HTTPS API) wins when configured — works on PaaS that block SMTP.
    if (resendProvider.isResendConfigured()) {
        return resendProvider.send({ from, to, cc, subject, html, text });
    }

    // Fallback: nodemailer over SMTP (used on local dev and in envs without Resend).
    const transporter = getTransporter();
    if (!transporter) {
        const err = new Error('No mail provider configured (set RESEND_API_KEY or SMTP_HOST/USER/PASS)');
        err.code = 'MAIL_NOT_CONFIGURED';
        throw err;
    }
    const info = await transporter.sendMail({
        from,
        to,
        cc,
        subject,
        text: text || 'Please enable HTML to view this email.',
        html,
    });
    return info;
};

/**
 * Unified outbound mail entry point.
 *
 * Creates an EmailLog row, attempts immediate send, and updates the row with
 * SENT / PENDING (queued for retry) / DEAD (max attempts reached). Never
 * throws on transport failure — caller inspects `result.ok` and decides what
 * to do (e.g. forgot-password deletes its reset row on failure).
 *
 * @param {Object} opts
 * @param {string} opts.to
 * @param {string} opts.subject
 * @param {string} [opts.template] — file under src/services/mail/templates without .html
 * @param {Object} [opts.vars]     — variables for the template ({{name}} substitution)
 * @param {string} [opts.html]     — raw HTML (if no template)
 * @param {string} [opts.text]     — plain-text fallback
 * @param {string} [opts.cc]
 * @param {string} [opts.tenantId] — nullable; nullable when pre-auth (password reset)
 * @returns {Promise<{ok: boolean, logId: string|null, status: string, error?: string, suppressed?: boolean}>}
 */
const sendMail = async (opts) => {
    const { to, subject, template, vars, html: rawHtml, text: rawText, cc, tenantId } = opts || {};

    if (!to || !subject) {
        throw new Error('mail.sendMail: `to` and `subject` are required');
    }

    if (!notificationsEnabled()) {
        logger.info(`[mail] notifications disabled — suppressing "${subject}" → ${to}`);
        return { ok: true, logId: null, status: 'SUPPRESSED', suppressed: true };
    }

    const { html, text } = buildHtmlAndText({ template, vars, html: rawHtml, text: rawText });

    const log = await prisma.emailLog.create({
        data: {
            tenantId: tenantId || null,
            to,
            cc: cc || null,
            subject,
            template: template || null,
            body: html || text || '',
            status: 'PENDING',
            attempts: 0,
        },
    });

    try {
        const info = await attemptTransport({ to, cc, subject, html, text });
        await prisma.emailLog.update({
            where: { id: log.id },
            data: {
                status: 'SENT',
                attempts: 1,
                sentAt: new Date(),
                lastError: null,
                nextRetryAt: null,
            },
        });
        logger.info(`[mail] sent log=${log.id} to=${to} messageId=${info.messageId}`);
        return { ok: true, logId: log.id, status: 'SENT' };
    } catch (err) {
        const attempts = 1;
        const maxAttempts = getMaxAttempts();
        const isDead = attempts >= maxAttempts;
        const nextRetryAt = isDead ? null : new Date(Date.now() + computeBackoffMs(attempts));

        await prisma.emailLog.update({
            where: { id: log.id },
            data: {
                status: isDead ? 'DEAD' : 'PENDING',
                attempts,
                lastError: err?.message?.slice(0, 2000) || String(err),
                nextRetryAt,
            },
        });

        logger.warn(
            `[mail] initial send failed log=${log.id} to=${to} attempts=${attempts}/${maxAttempts} reason=${err?.message}`
        );

        return {
            ok: false,
            logId: log.id,
            status: isDead ? 'DEAD' : 'PENDING',
            error: err?.message,
        };
    }
};

module.exports = {
    sendMail,
    isSmtpConfigured,
    notificationsEnabled,
    getMaxAttempts,
    getInitialDelaySeconds,
    computeBackoffMs,
};
