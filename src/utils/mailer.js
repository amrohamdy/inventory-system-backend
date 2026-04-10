'use strict';

const nodemailer = require('nodemailer');
const logger = require('./logger');

const parsePort = () => {
    const p = process.env.SMTP_PORT;
    if (p === undefined || p === '') return 587;
    const n = parseInt(String(p), 10);
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

const createTransporter = () => {
    const port = parsePort();
    const secureEnv = process.env.SMTP_SECURE;
    const secure =
        secureEnv === 'true' || secureEnv === '1' || port === 465;

    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });
};

/**
 * Send transactional email via SMTP (env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS).
 * Optional: SMTP_SECURE=true, EMAIL_FROM
 */
const sendMail = async ({ to, subject, html, text }) => {
    if (!isSmtpConfigured()) {
        const err = new Error('SMTP is not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS).');
        err.statusCode = 503;
        err.code = 'SMTP_NOT_CONFIGURED';
        throw err;
    }

    const transporter = createTransporter();
    const from =
        process.env.EMAIL_FROM || '"OSE Inventory" <noreply@ose-inventory.local>';

    const info = await transporter.sendMail({
        from,
        to,
        subject,
        text: text || 'Please use an HTML-capable client to read this message.',
        html,
    });

    logger.info(`[mailer] sent to ${to} messageId=${info.messageId}`);
    return info;
};

/**
 * HTML email for password reset OTP.
 */
const sendPasswordResetOtpEmail = async ({ to, otp, expiresMinutes }) => {
    const subject = 'Your password reset code';
    const safeOtp = String(otp).replace(/[^0-9]/g, '');
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f4f5;padding:24px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);overflow:hidden;">
    <tr><td style="padding:28px 28px 8px;">
      <h1 style="margin:0;font-size:20px;color:#18181b;">Password reset</h1>
      <p style="margin:16px 0 0;font-size:15px;line-height:1.5;color:#3f3f46;">
        Use this code to reset your password. It expires in <strong>${expiresMinutes}</strong> minutes.
      </p>
    </td></tr>
    <tr><td style="padding:8px 28px 28px;">
      <div style="font-size:32px;letter-spacing:8px;font-weight:700;color:#18181b;text-align:center;padding:16px 12px;background:#fafafa;border-radius:8px;border:1px solid #e4e4e7;">
        ${safeOtp}
      </div>
      <p style="margin:20px 0 0;font-size:13px;color:#71717a;">
        If you did not request this, you can ignore this email. Your password will stay the same.
      </p>
    </td></tr>
  </table>
</body>
</html>`.trim();

    const text = `Password reset\n\nYour code: ${safeOtp}\n\nIt expires in ${expiresMinutes} minutes.\n\nIf you did not request this, ignore this email.`;

    return sendMail({ to, subject, html, text });
};

module.exports = {
    isSmtpConfigured,
    sendMail,
    sendPasswordResetOtpEmail,
};
