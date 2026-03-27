'use strict';
const mappingService = require('../services/mapping.service');

const sendSuccess = (res, data, status = 200) => res.status(status).json({ success: true, data });
const sendError = (res, err) => {
    const status = err.status || err.statusCode || 500;
    res.status(status).json({ success: false, message: err.message });
};

const assertFinance = (req) => {
    const role = req.user?.role;
    if (!['FINANCE_MANAGER', 'COST_CONTROL', 'ADMIN'].includes(role))
        throw Object.assign(new Error('Finance role required for mapping operations.'), { status: 403 });
};

// ─── Item Mappings ────────────────────────────────────────────────────────────

const listItemMappings = async (req, res) => {
    try {
        const result = await mappingService.listItemMappings(req.user.tenantId);
        sendSuccess(res, result);
    } catch (err) { sendError(res, err); }
};

const upsertItemMapping = async (req, res) => {
    try {
        assertFinance(req);
        const { futurelogItemCode, futurelogItemName, internalItemId } = req.body;
        if (!futurelogItemCode || !internalItemId)
            return res.status(400).json({ success: false, message: 'futurelogItemCode and internalItemId are required' });
        const result = await mappingService.upsertItemMapping({
            tenantId: req.user.tenantId,
            userId: req.user.id,
            futurelogItemCode,
            futurelogItemName: futurelogItemName || futurelogItemCode,
            internalItemId,
        });
        sendSuccess(res, result, 200);
    } catch (err) { sendError(res, err); }
};

// ─── UOM Mappings ─────────────────────────────────────────────────────────────

const listUomMappings = async (req, res) => {
    try {
        const result = await mappingService.listUomMappings(req.user.tenantId);
        sendSuccess(res, result);
    } catch (err) { sendError(res, err); }
};

const upsertUomMapping = async (req, res) => {
    try {
        assertFinance(req);
        const { futurelogUom, internalUomId, conversionFactor } = req.body;
        if (!futurelogUom || !internalUomId)
            return res.status(400).json({ success: false, message: 'futurelogUom and internalUomId are required' });
        const result = await mappingService.upsertUomMapping({
            tenantId: req.user.tenantId,
            userId: req.user.id,
            futurelogUom,
            internalUomId,
            conversionFactor: conversionFactor ?? 1,
        });
        sendSuccess(res, result);
    } catch (err) { sendError(res, err); }
};

// ─── Vendor Mappings ──────────────────────────────────────────────────────────

const listVendorMappings = async (req, res) => {
    try {
        const result = await mappingService.listVendorMappings(req.user.tenantId);
        sendSuccess(res, result);
    } catch (err) { sendError(res, err); }
};

const upsertVendorMapping = async (req, res) => {
    try {
        assertFinance(req);
        const { futurelogVendorName, internalSupplierId } = req.body;
        if (!futurelogVendorName || !internalSupplierId)
            return res.status(400).json({ success: false, message: 'futurelogVendorName and internalSupplierId are required' });
        const result = await mappingService.upsertVendorMapping({
            tenantId: req.user.tenantId,
            userId: req.user.id,
            futurelogVendorName,
            internalSupplierId,
        });
        sendSuccess(res, result);
    } catch (err) { sendError(res, err); }
};

const getUnmatchedVendors = async (req, res) => {
    try {
        const result = await mappingService.getUnmatchedVendors(req.user.tenantId);
        sendSuccess(res, result);
    } catch (err) { sendError(res, err); }
};

/** POST /api/mappings/apply-to-grn/:grnId — re-run all mappings against a GRN */
const applyMappingsToGrn = async (req, res) => {
    try {
        const result = await mappingService.applyMappingsToGrn(req.params.grnId, req.user.tenantId);
        sendSuccess(res, result);
    } catch (err) { sendError(res, err); }
};

module.exports = {
    listItemMappings, upsertItemMapping,
    listUomMappings, upsertUomMapping,
    listVendorMappings, upsertVendorMapping,
    getUnmatchedVendors,
    applyMappingsToGrn,
};
