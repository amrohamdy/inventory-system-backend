const ledgerService = require('../services/ledger.service');
const { success } = require('../utils/response');

/**
 * @desc    Get paginated ledger entries with filters
 * @route   GET /api/ledger
 * @access  Private
 */
const getLedgerEntries = async (req, res, next) => {
    try {
        const result = await ledgerService.getLedgerEntries(req.user.tenantId, req.query);
        return success(res, result.entries, 'Ledger entries fetched successfully', 200, {
            total: result.total,
            skip: parseInt(req.query.skip) || 0,
            take: parseInt(req.query.take) || 50,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Get ledger entries for a specific document
 * @route   GET /api/ledger/by-document/:documentId
 * @access  Private
 */
const getLedgerByDocument = async (req, res, next) => {
    try {
        const entries = await ledgerService.getLedgerByDocument(
            req.params.documentId,
            req.user.tenantId
        );
        return success(res, entries, 'Document ledger entries fetched successfully');
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getLedgerEntries,
    getLedgerByDocument
};
