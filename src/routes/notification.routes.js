const express = require('express');
const router = express.Router();
const notificationService = require('../services/notification.service');
const { authenticate } = require('../middleware/authenticate');
const { success } = require('../utils/response');

router.use(authenticate);

// GET /api/notifications/summary — bell badge count + top alerts
router.get('/summary', async (req, res, next) => {
    try {
        const summary = await notificationService.getNotificationSummary(req.user.tenantId);
        return success(res, summary);
    } catch (err) { next(err); }
});

// GET /api/notifications/low-stock — full low stock list
router.get('/low-stock', async (req, res, next) => {
    try {
        const alerts = await notificationService.getLowStockAlerts(req.user.tenantId);
        return success(res, alerts);
    } catch (err) { next(err); }
});

module.exports = router;
