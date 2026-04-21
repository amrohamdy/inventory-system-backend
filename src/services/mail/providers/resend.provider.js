'use strict';

const { Resend } = require('resend');
const logger = require('../../../utils/logger');

let _cached = null;

const isResendConfigured = () =>
    typeof process.env.RESEND_API_KEY === 'string' && process.env.RESEND_API_KEY.startsWith('re_');

const getClient = () => {
    if (_cached) return _cached;
    if (!isResendConfigured()) return null;
    _cached = new Resend(process.env.RESEND_API_KEY);
    logger.info('[mail] Resend provider initialized');
    return _cached;
};

const send = async ({ from, to, cc, subject, html, text }) => {
    const client = getClient();
    if (!client) {
        const err = new Error('Resend not configured (set RESEND_API_KEY)');
        err.code = 'RESEND_NOT_CONFIGURED';
        throw err;
    }
    const { data, error } = await client.emails.send({
        from,
        to: Array.isArray(to) ? to : [to],
        cc: cc ? (Array.isArray(cc) ? cc : [cc]) : undefined,
        subject,
        html,
        text: text || 'Please enable HTML to view this email.',
    });
    if (error) {
        const err = new Error(error.message || 'Resend API error');
        err.code = error.name || 'RESEND_ERROR';
        throw err;
    }
    return { messageId: data?.id };
};

module.exports = { send, isResendConfigured };
