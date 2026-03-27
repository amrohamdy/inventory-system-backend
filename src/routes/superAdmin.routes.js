const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { requireSuperAdmin } = require('../middleware/requireSuperAdmin');
const ctrl = require('../controllers/superAdmin.controller');
const tenantRoutes = require('./tenant.routes');
const { createSuperAdminTenantValidator, createFullOrganizationValidator } = require('../utils/validators');

// ─── All Super Admin routes require JWT + SUPER_ADMIN role ───────────────────
router.use(authenticate, requireSuperAdmin);

// ─── Tenant Management ────────────────────────────────────────────────────────
router.get('/tenants', ctrl.listTenants);
router.post('/tenants', createSuperAdminTenantValidator, ctrl.createTenant);
router.post('/tenants/full-organization', createFullOrganizationValidator, ctrl.createFullOrganization);
router.get('/tenants/:id', ctrl.getTenant);
router.put('/tenants/:id', ctrl.updateTenant);
router.post('/tenants/:id/activate', ctrl.activateTenant);
router.post('/tenants/:id/suspend', ctrl.suspendTenant);
router.put('/tenants/:id/subscription', ctrl.setSubscription);
router.post('/tenants/:id/force-logout', ctrl.forceLogout);
router.post('/tenants/:id/impersonate', ctrl.impersonate);

// Keep legacy tenant routes (PATCH endpoints) under /tenants without shadowing
// super-admin list/detail routes above.
router.use('/tenants', tenantRoutes);

// ─── Admin Audit Logs ─────────────────────────────────────────────────────────
router.get('/logs', ctrl.getAdminLogs);

module.exports = router;
