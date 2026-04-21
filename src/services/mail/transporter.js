'use strict';

const nodemailer = require('nodemailer');
const logger = require('../../utils/logger');

let _cached = null;

const parsePort = () => {
    const raw = process.env.SMTP_PORT;
    if (raw === undefined || raw === '') return 587;
    const n = parseInt(String(raw), 10);
    return Number.isFinite(n) ? n : 587;
};

const isSmtpConfigured = () =>
    Boolean(
        typeof process.env.SMTP_HOST === 'string' &&
            process.env.SMTP_HOST.trim() &&
            typeof process.env.SMTP_USER === 'string' &&
            process.env.SMTP_USER.trim() &&
            typeof process.env.SMTP_PASS === 'string' &&
            process.env.SMTP_PASS.length > 0
    );

const notificationsEnabled = () => process.env.EMAIL_NOTIFICATIONS_ENABLED !== 'false';

const getFromAddress = () =>
    process.env.EMAIL_FROM || '"OS&E Inventory" <noreply@ose-inventory.local>';

const getTransporter = () => {
    if (_cached) return _cached;
    if (!isSmtpConfigured()) return null;

    const port = parsePort();
    const secureEnv = process.env.SMTP_SECURE;
    const secure = secureEnv === 'true' || secureEnv === '1' || port === 465;

    _cached = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
        // Railway's networking blocks IPv6 SMTP egress; force IPv4 so nodemailer
        // doesn't resolve smtp.gmail.com to an AAAA record and then ENETUNREACH.
        family: 4,
    });

    logger.info(`[mail] SMTP transporter initialized host=${process.env.SMTP_HOST} port=${port} secure=${secure}`);
    return _cached;
};

const resetTransporterForTest = () => {
    _cached = null;
};

module.exports = {
    getTransporter,
    isSmtpConfigured,
    notificationsEnabled,
    getFromAddress,
    resetTransporterForTest,
};
