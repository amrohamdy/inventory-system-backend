const superAdminService = require('../services/superAdmin.service');

// ─── List Tenants ─────────────────────────────────────────────────────────────
const listTenants = async (req, res, next) => {
    try {
        console.log('[SUPER_ADMIN][listTenants] Request URL:', req.originalUrl);
        console.log('[SUPER_ADMIN][listTenants] Query params:', req.query);
        const result = await superAdminService.listTenants(req.query);
        res.json({ success: true, data: result });
    } catch (e) { next(e); }
};

// ─── Get Tenant Detail ────────────────────────────────────────────────────────
const getTenant = async (req, res, next) => {
    try {
        const tenant = await superAdminService.getTenant(req.params.id);
        res.json({ success: true, data: tenant });
    } catch (e) { next(e); }
};

// ─── Create Tenant ────────────────────────────────────────────────────────────
const createTenant = async (req, res, next) => {
    try {
        const tenant = await superAdminService.createTenant(req.body, req.user.id, req.ip);
        res.status(201).json({ success: true, data: tenant });
    } catch (e) { next(e); }
};

// ─── Create Full Organization (Org + Admin + First Hotel) ─────────────────────
const createFullOrganization = async (req, res, next) => {
    try {
        const result = await superAdminService.createFullOrganization(req.body, req.user.id, req.ip);
        res.status(201).json({ success: true, data: result });
    } catch (e) { next(e); }
};

// ─── Update Tenant ────────────────────────────────────────────────────────────
const updateTenant = async (req, res, next) => {
    try {
        const tenant = await superAdminService.updateTenant(req.params.id, req.body, req.user.id, req.ip);
        res.json({ success: true, data: tenant });
    } catch (e) { next(e); }
};

// ─── Activate Tenant ──────────────────────────────────────────────────────────
const activateTenant = async (req, res, next) => {
    try {
        const tenant = await superAdminService.activateTenant(req.params.id, req.user.id, req.ip);
        res.json({ success: true, data: tenant, message: 'Tenant activated.' });
    } catch (e) { next(e); }
};

// ─── Suspend Tenant ───────────────────────────────────────────────────────────
const suspendTenant = async (req, res, next) => {
    try {
        await superAdminService.suspendTenant(req.params.id, req.user.id, req.ip);
        res.json({ success: true, message: 'Tenant suspended. All sessions revoked.' });
    } catch (e) { next(e); }
};

// ─── Set Subscription ─────────────────────────────────────────────────────────
const setSubscription = async (req, res, next) => {
    try {
        const sub = await superAdminService.setSubscription(req.params.id, req.body, req.user.id, req.ip);
        res.json({ success: true, data: sub });
    } catch (e) { next(e); }
};

// ─── Force Logout ─────────────────────────────────────────────────────────────
const forceLogout = async (req, res, next) => {
    try {
        await superAdminService.forceLogoutTenant(req.params.id, req.user.id, req.ip);
        res.json({ success: true, message: 'All tenant sessions revoked.' });
    } catch (e) { next(e); }
};

// ─── Impersonate ──────────────────────────────────────────────────────────────
const impersonate = async (req, res, next) => {
    try {
        const result = await superAdminService.impersonateTenant(req.params.id, req.user.id, req.ip);
        res.json({ success: true, data: result });
    } catch (e) { next(e); }
};

// ─── Admin Logs ───────────────────────────────────────────────────────────────
const getAdminLogs = async (req, res, next) => {
    try {
        const result = await superAdminService.getAdminLogs(req.query);
        res.json({ success: true, data: result });
    } catch (e) { next(e); }
};

module.exports = {
    listTenants,
    getTenant,
    createTenant,
    createFullOrganization,
    updateTenant,
    activateTenant,
    suspendTenant,
    setSubscription,
    forceLogout,
    impersonate,
    getAdminLogs,
};
