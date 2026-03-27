const express = require('express');
const tenantController = require('../controllers/tenant.controller');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { createTenantValidator } = require('../utils/validators');

const router = express.Router();

// Tenant listing/creation supports hierarchy roles.
router.use(authenticate);
router.use(authorize('SUPER_ADMIN', 'ORG_MANAGER', 'ADMIN'));

// GET /api/admin/tenants
router.get('/', tenantController.listTenants);

// POST /api/admin/tenants
router.post('/', createTenantValidator, tenantController.createTenant);

// GET /api/admin/tenants/:id
router.get('/:id', tenantController.getTenant);

// PUT /api/admin/tenants/:id
router.put('/:id', tenantController.updateTenant);

// PATCH /api/admin/tenants/:id/toggle
router.patch('/:id/toggle', tenantController.toggleTenant);

// PATCH /api/admin/tenants/:id/suspend (SUPER_ADMIN only)
router.patch('/:id/suspend', authorize('SUPER_ADMIN'), tenantController.suspendTenant);

module.exports = router;
