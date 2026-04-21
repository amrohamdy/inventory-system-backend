'use strict';

/**
 * @deprecated — thin back-compat shim over src/services/mail/mail.service.
 *
 * The four exported helpers preserve their original signatures so all existing
 * callers (grn.service, breakage.service, transfer.service, stockReport.service,
 * scheduler.js) continue to work unchanged. New code should call `mail.sendMail`
 * directly with the appropriate template name.
 */

const mail = require('./mail/mail.service');

const TYPE_LABELS = {
    BREAKAGE: 'Breakage/Loss Report',
    GRN: 'Goods Receipt Note',
    LOAN: 'Asset Transfer',
    STOCK_REPORT: 'Stock Report',
    TRANSFER: 'Inter-Store Transfer',
};

const escape = (v) =>
    String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const sendEmail = ({ to, subject, html, text }) =>
    mail.sendMail({ to, subject, html, text });

const sendApprovalPendingNotification = async (request, user, approverEmail) => {
    if (!approverEmail) return;
    const readableType = TYPE_LABELS[request?.type] || request?.type || 'Request';
    const submitterName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'User';
    const submittedAt = new Date(request?.createdAt || Date.now()).toLocaleString();
    const notesBlock = request?.notes
        ? `<p style="margin: 5px 0;"><strong>Notes:</strong> ${escape(request.notes)}</p>`
        : '';

    return mail.sendMail({
        to: approverEmail,
        subject: `Action Required: New ${request?.type || ''} Approval Pending`.trim(),
        template: 'approval-pending',
        vars: { readableType, submitterName, submittedAt, notesBlock },
        tenantId: request?.tenantId || null,
    });
};

const sendCriticalStockAlert = async (alerts, recipientEmail) => {
    if (!recipientEmail || !Array.isArray(alerts) || alerts.length === 0) return;
    const critical = alerts.filter((a) => a.severity === 'critical');
    if (critical.length === 0) return;

    const itemsHtml = critical
        .map(
            (a) => `
        <li style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #e5e7eb;">
            <strong>${escape(a.itemName)}</strong> at <em>${escape(a.locationName)}</em><br/>
            Current Stock: <strong style="color: #ef4444;">${escape(a.currentStock)}</strong>
            (Min: ${escape(a.minQty ?? 'N/A')}, Reorder: ${escape(a.reorderPoint ?? 'N/A')})
        </li>`
        )
        .join('');

    return mail.sendMail({
        to: recipientEmail,
        subject: `URGENT: ${critical.length} Critical Stock Alert(s)`,
        template: 'critical-stock-alert',
        vars: { itemsHtml },
    });
};

const sendApprovalResultNotification = async (request, action, submitterEmail, reason, approver) => {
    if (!submitterEmail) return;
    const isApproved = action === 'APPROVED';
    const readableType = TYPE_LABELS[request?.type] || request?.type || 'Request';
    const approverName = [approver?.firstName, approver?.lastName].filter(Boolean).join(' ') || 'Approver';
    const actedAt = new Date().toLocaleString();

    const notesBlock = request?.notes
        ? `<p style="margin: 5px 0;"><strong>Reference/Notes:</strong> ${escape(request.notes)}</p>`
        : '';
    const reasonBlock = !isApproved && reason
        ? `<p style="margin: 5px 0; color: #ef4444;"><strong>Reason:</strong> ${escape(reason)}</p>`
        : '';

    return mail.sendMail({
        to: submitterEmail,
        subject: `Update: ${request?.type || ''} ${isApproved ? 'Approved' : 'Rejected'}`.trim(),
        template: 'approval-result',
        vars: {
            statusColor: isApproved ? '#16a34a' : '#ef4444',
            statusLabel: isApproved ? 'Approved' : 'Rejected',
            statusLabelLower: isApproved ? 'approved' : 'rejected',
            readableType,
            approverName,
            actedAt,
            notesBlock,
            reasonBlock,
        },
        tenantId: request?.tenantId || null,
    });
};

module.exports = {
    sendEmail,
    sendApprovalPendingNotification,
    sendCriticalStockAlert,
    sendApprovalResultNotification,
};
