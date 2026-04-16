const getPassService = require('../services/getPass.service');
const getPassPdfService = require('../services/pdf/getPassPdf.service');
const periodGuard = require('../services/periodGuard.service');

const createGetPass = async (req, res) => {
    const { user } = req;
    await periodGuard.assertOperationalTransactionsAllowed(user.tenantId);
    const result = await getPassService.createGetPass(user.tenantId, req.body, user.id);
    res.status(201).json({ success: true, data: result });
};

const getGetPasses = async (req, res) => {
    const result = await getPassService.getGetPasses(req.user.tenantId, req.query, req.user);
    res.json({ success: true, ...result });
};

const getIncomingGetPasses = async (req, res) => {
    const result = await getPassService.getIncomingGetPasses(req.user.tenantId, req.query, req.user);
    res.json({ success: true, ...result });
};

const getReturningGetPasses = async (req, res) => {
    const result = await getPassService.getReturningGetPasses(req.user.tenantId, req.query, req.user);
    res.json({ success: true, ...result });
};

const getDiscrepancyClaims = async (req, res) => {
    const result = await getPassService.getDiscrepancyClaims(req.user.tenantId, req.user);
    res.json({ success: true, data: result });
};

const checkOverdueGetPasses = async (req, res) => {
    const notifyCostControl = String(req.query.notify ?? 'false').toLowerCase() === 'true';
    const result = await getPassService.checkAndNotifyOverduePasses({ notifyCostControl });
    res.json({ success: true, data: result });
};

const getGetPassById = async (req, res) => {
    const result = await getPassService.getGetPassById(req.params.id, req.user.tenantId);
    res.json({ success: true, data: result });
};

const updateGetPass = async (req, res) => {
    const { user } = req;
    const result = await getPassService.updateGetPass(req.params.id, user.tenantId, req.body, user.id);
    res.json({ success: true, data: result });
};

const deleteGetPass = async (req, res) => {
    const { user } = req;
    await getPassService.deleteGetPass(req.params.id, user.tenantId, user.id);
    res.json({ success: true, message: 'Get Pass deleted successfully' });
};

// Workflow
const submitGetPass = async (req, res) => {
    const { user } = req;
    const result = await getPassService.submitGetPass(req.params.id, user.tenantId, user);
    res.json({ success: true, data: result });
};

const approveGetPass = async (req, res) => {
    const { user } = req;
    const result = await getPassService.approveGetPass(req.params.id, user.tenantId, user);
    res.json({ success: true, data: result });
};

const rejectGetPass = async (req, res) => {
    const { user } = req;
    const { rejectionReason } = req.body;
    const result = await getPassService.rejectGetPass(req.params.id, user.tenantId, user, rejectionReason);
    res.json({ success: true, data: result });
};

const confirmDestinationReceipt = async (req, res) => {
    const { user } = req;
    const { id } = req.params;
    const result = await getPassService.confirmDestinationReceipt(id, user.tenantId, user.id, req.body);
    res.json({ success: true, data: result });
};

const acceptDestinationDepartment = async (req, res) => {
    const { user } = req;
    const { id } = req.params;
    const result = await getPassService.acceptDestinationDepartment(id, user.tenantId, user, req.body);
    res.json({ success: true, data: result });
};

const shipBackGetPass = async (req, res) => {
    const { user } = req;
    const { id } = req.params;
    const result = await getPassService.shipBackGetPass(id, user.tenantId, user);
    res.json({ success: true, data: result });
};

const confirmReturnExit = async (req, res) => {
    const { user } = req;
    const { id } = req.params;
    const result = await getPassService.confirmReturnExit(id, user.tenantId, user);
    res.json({ success: true, data: result });
};

const confirmReturnArrival = async (req, res) => {
    const { user } = req;
    const { id } = req.params;
    const result = await getPassService.confirmReturnArrival(id, user.tenantId, user, req.body);
    res.json({ success: true, data: result });
};

const acceptReturnIntoDepartment = async (req, res) => {
    const { user } = req;
    const { id } = req.params;
    const result = await getPassService.acceptReturnIntoDepartment(id, user.tenantId, user, req.body);
    res.json({ success: true, data: result });
};

const returnGetPass = async (req, res) => {
    const { user } = req;
    const { id } = req.params;
    const { lines, notes } = req.body; 
    const result = await getPassService.processReturns(id, user.tenantId, user.id, lines, notes);
    res.json({ success: true, data: result });
};

const closeGetPass = async (req, res) => {
    const { user } = req;
    const { id } = req.params;
    const result = await getPassService.closeGetPass(id, user.tenantId, user.id);
    res.json({ success: true, data: result });
};

const exportPdf = async (req, res) => {
    const { id } = req.params;
    const tenantId = req.user.tenantId;
    const result = await getPassService.getGetPassById(id, tenantId);
    const pdfBuffer = await getPassPdfService.generatePdf(id, tenantId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=GatePass_${result.passNo}.pdf`);
    res.send(pdfBuffer);
};

module.exports = {
    createGetPass,
    getGetPasses,
    getIncomingGetPasses,
    getReturningGetPasses,
    getDiscrepancyClaims,
    checkOverdueGetPasses,
    getGetPassById,
    updateGetPass,
    deleteGetPass,
    submitGetPass,
    approveGetPass,
    rejectGetPass,
    confirmDestinationReceipt,
    acceptDestinationDepartment,
    shipBackGetPass,
    confirmReturnExit,
    confirmReturnArrival,
    acceptReturnIntoDepartment,
    returnGetPass,
    closeGetPass,
    exportPdf
};
