const tenantService = require('../services/tenant.service');
const { success, created } = require('../utils/response');

const listTenants = async (req, res, next) => {
    try {
        const result = await tenantService.listTenants(req.query, req.user);
        return success(res, result.tenants, 'Tenants retrieved successfully', 200, {
            meta: {
                page: result.page,
                limit: result.limit,
                total: result.total
            }
        });
    } catch (err) {
        next(err);
    }
};

const getTenant = async (req, res, next) => {
    try {
        const tenant = await tenantService.getTenantById(req.params.id);
        return success(res, tenant);
    } catch (err) {
        next(err);
    }
};

const createTenant = async (req, res, next) => {
    try {
        const tenant = await tenantService.createTenant(req.body);
        const message = req.body?.parentId
            ? 'Branch created successfully.'
            : 'Organization created successfully.';
        return created(res, tenant, message);
    } catch (err) {
        next(err);
    }
};

const updateTenant = async (req, res, next) => {
    try {
        const tenant = await tenantService.updateTenantLicense(req.params.id, req.body);
        return success(res, tenant, 'Tenant license updated successfully');
    } catch (err) {
        next(err);
    }
};

const toggleTenant = async (req, res, next) => {
    try {
        const tenant = await tenantService.toggleTenantStatus(req.params.id);
        return success(res, tenant, `Tenant is now ${tenant.isActive ? 'Active' : 'Inactive'}`);
    } catch (err) {
        next(err);
    }
};

const suspendTenant = async (req, res, next) => {
    try {
        const tenant = await tenantService.suspendTenant(req.params.id);
        return success(res, tenant, 'Organization suspended successfully', 200);
    } catch (err) {
        next(err);
    }
};

module.exports = {
    listTenants,
    getTenant,
    createTenant,
    updateTenant,
    toggleTenant,
    suspendTenant
};
