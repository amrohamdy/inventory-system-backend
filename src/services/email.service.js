const nodemailer = require('nodemailer');
const winston = require('winston');

// Logger for email service
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
        // Add file transport in production if needed
    ],
});

// Configure transporter
// Note: In production, these should be environment variables
const createTransporter = () => {
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'localhost',
        port: process.env.SMTP_PORT || 1025, // Default for mailhog/maildev
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });
};

/**
 * Send an email
 * @param {Object} options Email options
 * @param {string} options.to Recipient email address
 * @param {string} options.subject Email subject
 * @param {string} options.html HTML email body
 * @param {string} [options.text] Plain text email body (optional for fallback)
 */
const sendEmail = async ({ to, subject, html, text }) => {
    if (process.env.EMAIL_NOTIFICATIONS_ENABLED !== 'true') {
        logger.info(`[Email Service] Email notifications are disabled. Suppressing email to ${to}: ${subject}`);
        return;
    }

    try {
        const transporter = createTransporter();
        const info = await transporter.sendMail({
            from: process.env.EMAIL_FROM || '"OSE Inventory System" <noreply@oseinventory.com>',
            to,
            subject,
            text: text || "Please enable HTML to view this email.",
            html,
        });

        logger.info(`[Email Service] Email sent successfully to ${to}. MessageId: ${info.messageId}`);
        return info;
    } catch (error) {
        logger.error(`[Email Service] Failed to send email to ${to}. Error: ${error.message}`);
        throw error;
    }
};

/**
 * Send a notification for a pending approval request
 * @param {Object} request The approval request object
 * @param {Object} user The user who created the request
 * @param {string} approverEmail The email of the person who needs to approve it
 */
const sendApprovalPendingNotification = async (request, user, approverEmail) => {
    if (!approverEmail) return;

    const subject = `Action Required: New ${request.type} Approval Pending`;

    // Quick mapping for readable type
    const types = {
        'BREAKAGE': 'Breakage/Loss Report',
        'GRN': 'Goods Receipt Note',
        'LOAN': 'Asset Transfer',
        'STOCK_REPORT': 'Stock Report',
        'TRANSFER': 'Inter-Store Transfer'
    };
    const readableType = types[request.type] || request.type;

    const html = `
        <div style="font-family: Arial, sans-serif; max-w: 600px; margin: 0 auto; color: #333;">
            <h2 style="color: #2563eb; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px;">Approval Required</h2>
            <p>Hello,</p>
            <p>A new <strong>${readableType}</strong> has been submitted and is pending your approval.</p>
            
            <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 5px 0;"><strong>Submitted By:</strong> ${user?.firstName} ${user?.lastName}</p>
                <p style="margin: 5px 0;"><strong>Date:</strong> ${new Date(request.createdAt).toLocaleString()}</p>
                ${request.notes ? `<p style="margin: 5px 0;"><strong>Notes:</strong> ${request.notes}</p>` : ''}
            </div>
            
            <p>Please log in to the system to review and approve or reject this request.</p>
            <p style="margin-top: 30px; font-size: 12px; color: #6b7280; text-align: center;">
                This is an automated message from the OSE Inventory System. Please do not reply.
            </p>
        </div>
    `;

    return sendEmail({ to: approverEmail, subject, html });
};

/**
 * Send a notification for critical low stock
 * @param {Array} alerts Array of critical low stock alert objects
 * @param {string} recipientEmail The email to send the alerts to (e.g., manager/purchasing)
 */
const sendCriticalStockAlert = async (alerts, recipientEmail) => {
    if (!recipientEmail || !alerts || alerts.length === 0) return;

    // Filter to only include critical alerts if the list is mixed
    const criticalAlerts = alerts.filter(a => a.severity === 'critical');
    if (criticalAlerts.length === 0) return;

    const subject = `URGENT: ${criticalAlerts.length} Critical Stock Alert(s)`;

    let itemsHtml = criticalAlerts.map(alert => `
        <li style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #e5e7eb;">
            <strong>${alert.itemName}</strong> at <em>${alert.locationName}</em><br/>
            Current Stock: <strong style="color: #ef4444;">${alert.currentStock}</strong> 
            (Min: ${alert.minQty || 'N/A'}, Reorder: ${alert.reorderPoint || 'N/A'})
        </li>
    `).join('');

    const html = `
        <div style="font-family: Arial, sans-serif; max-w: 600px; margin: 0 auto; color: #333;">
            <h2 style="color: #ef4444; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px;">Critical Stock Alert</h2>
            <p>Hello,</p>
            <p>The following items have reached a critical low or out-of-stock level and require immediate attention:</p>
            
            <ul style="list-style-type: none; padding: 0; background-color: #fff1f2; padding: 15px; border-radius: 8px; border: 1px solid #fecdd3;">
                ${itemsHtml}
            </ul>
            
            <p>Please log in to the system to generate a reorder report or take necessary action.</p>
            <p style="margin-top: 30px; font-size: 12px; color: #6b7280; text-align: center;">
                This is an automated message from the OSE Inventory System. Please do not reply.
            </p>
        </div>
    `;

    return sendEmail({ to: recipientEmail, subject, html });
};

/**
 * Send a notification for an approval result
 * @param {Object} request The approval request object
 * @param {string} action 'APPROVED' or 'REJECTED'
 * @param {string} submitterEmail The email of the person who submitted the request
 * @param {string} [reason] Optional rejection reason
 * @param {Object} approver The user who approved/rejected
 */
const sendApprovalResultNotification = async (request, action, submitterEmail, reason, approver) => {
    if (!submitterEmail) return;

    const isApproved = action === 'APPROVED';
    const color = isApproved ? '#16a34a' : '#ef4444';
    const subject = `Update: ${request.type} ${isApproved ? 'Approved' : 'Rejected'}`;

    // Quick mapping for readable type
    const types = {
        'BREAKAGE': 'Breakage/Loss Report',
        'GRN': 'Goods Receipt Note',
        'LOAN': 'Asset Transfer',
        'STOCK_REPORT': 'Stock Report',
        'TRANSFER': 'Inter-Store Transfer'
    };
    const readableType = types[request.type] || request.type;

    const html = `
        <div style="font-family: Arial, sans-serif; max-w: 600px; margin: 0 auto; color: #333;">
            <h2 style="color: ${color}; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px;">
                Request ${isApproved ? 'Approved' : 'Rejected'}
            </h2>
            <p>Hello,</p>
            <p>Your <strong>${readableType}</strong> request has been <strong>${isApproved ? 'approved' : 'rejected'}</strong>.</p>
            
            <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 5px 0;"><strong>Action By:</strong> ${approver?.firstName} ${approver?.lastName}</p>
                <p style="margin: 5px 0;"><strong>Date:</strong> ${new Date().toLocaleString()}</p>
                ${request.notes ? `<p style="margin: 5px 0;"><strong>Reference/Notes:</strong> ${request.notes}</p>` : ''}
                ${!isApproved && reason ? `<p style="margin: 5px 0; color: #ef4444;"><strong>Reason:</strong> ${reason}</p>` : ''}
            </div>
            
            <p>Please log in to the system to view the full details.</p>
            <p style="margin-top: 30px; font-size: 12px; color: #6b7280; text-align: center;">
                This is an automated message from the OSE Inventory System. Please do not reply.
            </p>
        </div>
    `;

    return sendEmail({ to: submitterEmail, subject, html });
};

module.exports = {
    sendEmail,
    sendApprovalPendingNotification,
    sendCriticalStockAlert,
    sendApprovalResultNotification
};
