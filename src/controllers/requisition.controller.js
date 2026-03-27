'use strict';

const reqService = require('../services/requisition.service');
const MANAGER_ROLES = ['DEPT_MANAGER', 'FINANCE_MANAGER', 'ADMIN'];

const sendSuccess = (res, data, status = 200) => res.status(status).json({ success: true, data });
const sendError = (res, err) => res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message, details: err.details });
const assertManager = (req) => {
    if (!MANAGER_ROLES.includes(req.user?.role))
        throw Object.assign(new Error('Insufficient permissions. DEPT_MANAGER or higher required.'), { status: 403 });
};

// POST /api/requisitions
const createRequisition = async (req, res) => {
    try {
        const data = await reqService.createRequisition({
            tenantId: req.user.tenantId,
            userId: req.user.id,
            departmentName: req.body.departmentName,
            locationId: req.body.locationId,
            requiredBy: req.body.requiredBy,
            remarks: req.body.remarks,
            lines: req.body.lines || [],
        });
        sendSuccess(res, data, 201);
    } catch (err) { sendError(res, err); }
};

// GET /api/requisitions
const listRequisitions = async (req, res) => {
    try {
        const result = await reqService.listRequisitions(req.user.tenantId, {
            status: req.query.status,
            departmentName: req.query.department,
            locationId: req.query.locationId,
            dateFrom: req.query.dateFrom,
            dateTo: req.query.dateTo,
            page: +req.query.page || 1,
            limit: +req.query.limit || 20,
        });
        sendSuccess(res, result);
    } catch (err) { sendError(res, err); }
};

// GET /api/requisitions/:id
const getRequisition = async (req, res) => {
    try {
        const data = await reqService.getRequisition(req.params.id, req.user.tenantId);
        sendSuccess(res, data);
    } catch (err) { sendError(res, err); }
};

// PATCH /api/requisitions/:id
const updateRequisition = async (req, res) => {
    try {
        const data = await reqService.updateRequisition(req.params.id, req.user.tenantId, req.body);
        sendSuccess(res, data);
    } catch (err) { sendError(res, err); }
};

// DELETE /api/requisitions/:id
const deleteRequisition = async (req, res) => {
    try {
        await reqService.deleteRequisition(req.params.id, req.user.tenantId);
        res.status(200).json({ success: true, message: 'Requisition deleted.' });
    } catch (err) { sendError(res, err); }
};

// POST /api/requisitions/:id/submit
const submitRequisition = async (req, res) => {
    try {
        const data = await reqService.submitRequisition(req.params.id, req.user.tenantId);
        sendSuccess(res, data);
    } catch (err) { sendError(res, err); }
};

// POST /api/requisitions/:id/approve  — MANAGER only
const approveRequisition = async (req, res) => {
    try {
        assertManager(req);
        const data = await reqService.approveRequisition(req.params.id, req.user.tenantId, req.user.id, req.body.comment);
        sendSuccess(res, data);
    } catch (err) { sendError(res, err); }
};

// POST /api/requisitions/:id/reject  — MANAGER only
const rejectRequisition = async (req, res) => {
    try {
        assertManager(req);
        const data = await reqService.rejectRequisition(req.params.id, req.user.tenantId, req.user.id, req.body.reason);
        sendSuccess(res, data);
    } catch (err) { sendError(res, err); }
};

module.exports = {
    createRequisition, listRequisitions, getRequisition,
    updateRequisition, deleteRequisition,
    submitRequisition, approveRequisition, rejectRequisition,
};
