const getPassService = require('../services/getPass.service');
const getPassPdfService = require('../services/pdf/getPassPdf.service');

const createGetPass = async (req, res) => {
    const { user } = req;
    const result = await getPassService.createGetPass(user.tenantId, req.body, user.id);
    res.status(201).json({ success: true, data: result });
};

const getGetPasses = async (req, res) => {
    const result = await getPassService.getGetPasses(req.user.tenantId, req.query);
    res.json({ success: true, ...result });
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
    const result = await getPassService.submitGetPass(req.params.id, user.tenantId, user.id);
    res.json({ success: true, data: result });
};

const approveGetPass = async (req, res) => {
    const { user } = req;
    const { action, notes } = req.body; 
    const result = await getPassService.approveGetPass(req.params.id, user.tenantId, user, action, notes);
    res.json({ success: true, data: result });
};

const checkoutGetPass = async (req, res) => {
    const { user } = req;
    const { id } = req.params;
    const { lines } = req.body; 
    const result = await getPassService.checkoutGetPass(id, user.tenantId, user, lines);
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
    getGetPassById,
    updateGetPass,
    deleteGetPass,
    submitGetPass,
    approveGetPass,
    checkoutGetPass,
    returnGetPass,
    closeGetPass,
    exportPdf
};
