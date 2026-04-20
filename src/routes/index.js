const express = require('express');

const { authenticate } = require('../middleware/authenticate');
const authController = require('../controllers/auth.controller');
const authRoutes = require('./auth.routes');
const usersRoutes = require('./users.routes');
const rolesRoutes = require('./roles.routes');
const auditRoutes = require('./audit.routes');

const itemRoutes = require('./item.routes');
const categoryRoutes = require('./category.routes');
const locationRoutes = require('./location.routes');
const supplierRoutes = require('./supplier.routes');

// M03 - Inventory Core
const stockRoutes = require('./stock.routes');
const movementRoutes = require('./movement.routes');
const ledgerRoutes = require('./ledger.routes');

// M08 - Breakage
const breakageRoutes = require('./breakage.routes');
const lostItemsRoutes = require('./lostItems.routes');
const stockCountRoutes = require('./stockCount.routes');

const router = express.Router();

// GET /api/profile — real-time profile for settings (authenticated)
router.get('/profile', authenticate, authController.profile);

// M01 — Auth & Users
router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/roles', rolesRoutes);

// M14 — Audit Log
router.use('/audit-log', auditRoutes);

// M02 - Master Data
router.use('/items', itemRoutes);
router.use('/categories', categoryRoutes);
router.use('/locations', locationRoutes);
router.use('/suppliers', supplierRoutes);


// M03 - Inventory Core
router.use('/stock-balances', stockRoutes);
router.use('/movements', movementRoutes);
router.use('/ledger', ledgerRoutes);

// M05 - Units of Measure
const unitRoutes = require('./unit.routes');
router.use('/units', unitRoutes);

// M08 - Breakage
router.use('/breakage', breakageRoutes);
router.use('/lost', lostItemsRoutes);
router.use('/lost-items', lostItemsRoutes);

// M10: Stock Count
router.use('/stock-count', stockCountRoutes);

// M13: Reports
const reportsRoutes = require('./reports.routes');
router.use('/reports', reportsRoutes);

// M04-GRN: FutureLog GRN Import & Approval Gate
const grnRoutes = require('./grn.routes');
const mappingRoutes = require('./mapping.routes');
router.use('/grn', grnRoutes);
router.use('/mappings', mappingRoutes);

// M05-REQ: Store Requisition & Controlled Issue Gate
const requisitionRoutes = require('./requisition.routes');
const issueRoutes = require('./issue.routes');
router.use('/requisitions', requisitionRoutes);
router.use('/issues', issueRoutes);

// M06-TRF: Inter-Store Transfer Control Gate
const transferRoutes = require('./transfer.routes');
router.use('/transfers', transferRoutes);

// SaaS Phase 2: Executive Dashboard
const dashboardRoutes = require('./dashboard.routes');
router.use('/dashboard', dashboardRoutes);

// Get Pass
const getPassRoutes = require('./getPass.routes');
router.use('/get-passes', getPassRoutes);

// Departments
const departmentRoutes = require('./department.routes');
router.use('/departments', departmentRoutes);

// Notifications
const notificationRoutes = require('./notification.routes');
router.use('/notifications', notificationRoutes);

// Stock Report (Inventory Count Report)
const stockReportRoutes = require('./stockReport.routes');
router.use('/stock-report', stockReportRoutes);

// Period Close
const periodCloseRoutes = require('./periodClose.routes');
router.use('/period-close', periodCloseRoutes);

// Par Level
const parLevelRoutes = require('./parLevel.routes');
router.use('/par-levels', parLevelRoutes);

// Consumption Report
const consumptionRoutes = require('./consumption.routes');
router.use('/consumption', consumptionRoutes);

// Reorder Suggestions
const reorderRoutes = require('./reorder.routes');
router.use('/reorder', reorderRoutes);

// Tenant Settings
const settingRoutes = require('./setting.routes');
router.use('/settings', settingRoutes);

// Inventory status (OB phase) — PATCH contract for SPA
const inventoryRoutes = require('./inventory.routes');
router.use('/inventory', inventoryRoutes);

// Signed-URL resolver for cloud-stored attachments (authenticated + tenant-scoped)
const fileRoutes = require('./file.routes');
router.use('/files', fileRoutes);

// Super Admin — Tenant Management & Platform Controls
const superAdminRoutes = require('./superAdmin.routes');
router.use('/super-admin', superAdminRoutes);

// API v1 — organizations (root tenants)
const organizationRoutes = require('./organization.routes');
router.use('/v1/organizations', organizationRoutes);

// Tenant-scoped organization helpers (sister hotels, etc.)
const organizationPortalRoutes = require('./organization.portal.routes');
router.use('/organization', organizationPortalRoutes);

module.exports = router;

