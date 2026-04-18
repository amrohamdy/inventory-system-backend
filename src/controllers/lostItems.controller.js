const lostItemsService = require('../services/lostItems.service');
const { success } = require('../utils/response');

const createLost = async (req, res, next) => {
    try {
        const doc = await lostItemsService.createLost(
            req.user.tenantId,
            req.user.id,
            req.user.role,
            req.body,
        );
        return success(res, doc, 'Lost document created.', 201);
    } catch (e) {
        next(e);
    }
};

/** GET /api/lost-items */
const listLostItems = async (req, res, next) => {
    try {
        const { items, total } = await lostItemsService.listLostItems(req.user.tenantId, req.query);
        return success(res, items, 'Lost items fetched.', 200, {
            total,
            skip: Number.parseInt(String(req.query.skip), 10) || 0,
            take: Number.parseInt(String(req.query.take), 10) || 20,
        });
    } catch (e) {
        next(e);
    }
};

const approveDept = async (req, res, next) => {
    try {
        const doc = await lostItemsService.approveLostAtLevel(
            req.params.id,
            req.user.tenantId,
            req.user.id,
            req.user.role,
            'DRAFT',
        );
        return success(res, doc, 'Lost document approved by department manager.');
    } catch (e) {
        next(e);
    }
};

const approveCost = async (req, res, next) => {
    try {
        const doc = await lostItemsService.approveLostAtLevel(
            req.params.id,
            req.user.tenantId,
            req.user.id,
            req.user.role,
            'DEPT_APPROVED',
        );
        return success(res, doc, 'Lost document approved by cost control.');
    } catch (e) {
        next(e);
    }
};

const approveFinance = async (req, res, next) => {
    try {
        const doc = await lostItemsService.approveLostAtLevel(
            req.params.id,
            req.user.tenantId,
            req.user.id,
            req.user.role,
            'COST_CONTROL_APPROVED',
        );
        return success(res, doc, 'Lost document approved by finance.');
    } catch (e) {
        next(e);
    }
};

const approveGm = async (req, res, next) => {
    try {
        const doc = await lostItemsService.approveLostAtLevel(
            req.params.id,
            req.user.tenantId,
            req.user.id,
            req.user.role,
            'FINANCE_APPROVED',
        );
        return success(res, doc, 'Lost document approved by general manager.');
    } catch (e) {
        next(e);
    }
};

/** POST /api/lost-items/:id/approve — same 4-step chain as breakage (for lost docs with ApprovalRequest, e.g. get-pass return). */
const approveLostApprovalStep = async (req, res, next) => {
    try {
        const { comment } = req.body;
        const doc = await lostItemsService.processLostApprovalStep(
            req.params.id,
            req.user.tenantId,
            req.user.id,
            req.user.role,
            'APPROVE',
            comment,
        );
        return success(res, doc, 'Step approved.');
    } catch (e) {
        next(e);
    }
};

/** POST /api/lost-items/:id/reject */
const rejectLostApprovalStep = async (req, res, next) => {
    try {
        const { comment } = req.body;
        if (!comment?.trim()) {
            return res.status(400).json({ success: false, message: 'Rejection comment is required.' });
        }
        const doc = await lostItemsService.processLostApprovalStep(
            req.params.id,
            req.user.tenantId,
            req.user.id,
            req.user.role,
            'REJECT',
            comment,
        );
        return success(res, doc, 'Step rejected.');
    } catch (e) {
        next(e);
    }
};

module.exports = {
    createLost,
    listLostItems,
    approveDept,
    approveCost,
    approveFinance,
    approveGm,
    approveLostApprovalStep,
    rejectLostApprovalStep,
};
