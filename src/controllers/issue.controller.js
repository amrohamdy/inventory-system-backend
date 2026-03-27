'use strict';

const issueService = require('../services/issue.service');

const sendSuccess = (res, data, status = 200) => res.status(status).json({ success: true, data });
const sendError = (res, err) => res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message, details: err.details });

// POST /api/issues
const createIssue = async (req, res) => {
    try {
        const data = await issueService.createIssueDraft({
            tenantId: req.user.tenantId,
            userId: req.user.id,
            requisitionId: req.body.requisitionId,
            issueDate: req.body.issueDate,
            notes: req.body.notes,
            lines: req.body.lines || [],
        });
        sendSuccess(res, data, 201);
    } catch (err) { sendError(res, err); }
};

// GET /api/issues
const listIssues = async (req, res) => {
    try {
        const result = await issueService.listIssues(req.user.tenantId, {
            requisitionId: req.query.requisitionId,
            status: req.query.status,
            page: +req.query.page || 1,
            limit: +req.query.limit || 20,
        });
        sendSuccess(res, result);
    } catch (err) { sendError(res, err); }
};

// GET /api/issues/:id
const getIssue = async (req, res) => {
    try {
        const data = await issueService.getIssue(req.params.id, req.user.tenantId);
        sendSuccess(res, data);
    } catch (err) { sendError(res, err); }
};

// PATCH /api/issues/:id — notes only; 423 if POSTED
const updateIssue = async (req, res) => {
    try {
        const data = await issueService.updateIssueDraft(req.params.id, req.user.tenantId, { notes: req.body.notes });
        sendSuccess(res, data);
    } catch (err) { sendError(res, err); }
};

// DELETE /api/issues/:id — DRAFT only; 423 if POSTED
const deleteIssue = async (req, res) => {
    try {
        await issueService.deleteIssue(req.params.id, req.user.tenantId);
        res.status(200).json({ success: true, message: 'Issue deleted.' });
    } catch (err) { sendError(res, err); }
};

// POST /api/issues/:id/post — atomic posting
const postIssue = async (req, res) => {
    try {
        const data = await issueService.postIssue(req.params.id, req.user.tenantId, req.user.id);
        sendSuccess(res, data);
    } catch (err) { sendError(res, err); }
};

module.exports = {
    createIssue, listIssues, getIssue,
    updateIssue, deleteIssue, postIssue,
};
