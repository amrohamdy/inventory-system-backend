'use strict';

/**
 * @deprecated — thin back-compat shim. New code should call
 * `require('../services/mail/mail.service').sendMail` directly.
 *
 * Retained so existing callers (src/services/auth.service.js) keep working.
 * The actual transport + EmailLog + retry logic lives in src/services/mail/.
 */

const mail = require('../services/mail/mail.service');
const { isSmtpConfigured } = require('../services/mail/transporter');

const sendMail = async ({ to, subject, html, text }) => {
    const result = await mail.sendMail({ to, subject, html, text });
    if (!result.ok && !result.suppressed) {
        const err = new Error(result.error || 'Email delivery failed');
        err.code = 'EMAIL_SEND_FAILED';
        err.logId = result.logId;
        throw err;
    }
    return result;
};

const sendPasswordResetOtpEmail = async ({ to, otp, expiresMinutes }) => {
    const safeOtp = String(otp).replace(/[^0-9]/g, '');
    const result = await mail.sendMail({
        to,
        subject: 'Your password reset code',
        template: 'password-reset-otp',
        vars: { otp: safeOtp, expiresMinutes },
    });

    if (!result.ok && !result.suppressed) {
        const err = new Error(result.error || 'Password reset email failed to send');
        err.code = 'EMAIL_SEND_FAILED';
        err.logId = result.logId;
        throw err;
    }
    return result;
};

module.exports = {
    isSmtpConfigured,
    sendMail,
    sendPasswordResetOtpEmail,
};
