const express = require('express');
const auditService = require('../services/audit.service');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { paginated } = require('../utils/response');

const router = express.Router();

router.use(authenticate);
router.use(authorize('ADMIN', 'AUDITOR', 'FINANCE_MANAGER'));

// GET /api/audit-log
router.get('/', async (req, res) => {
    const { entityType, entityId, changedBy, from, to, page, limit } = req.query;
    const result = await auditService.getAuditLog(req.user.tenantId, {
        entityType,
        entityId,
        changedBy,
        from,
        to,
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 50,
    });
    return paginated(res, result.logs, { page: result.page, limit: result.limit, total: result.total });
});

// GET /api/audit-log/:entityType/:entityId
router.get('/:entityType/:entityId', async (req, res) => {
    const result = await auditService.getAuditLog(req.user.tenantId, {
        entityType: req.params.entityType,
        entityId: req.params.entityId,
        page: 1,
        limit: 100,
    });
    return paginated(res, result.logs, { page: 1, limit: 100, total: result.total });
});

module.exports = router;
