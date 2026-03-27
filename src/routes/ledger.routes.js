const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const ledgerController = require('../controllers/ledger.controller');

// All routes require authentication
router.use(authenticate);

// GET /api/ledger — paginated list with filters
router.get('/', ledgerController.getLedgerEntries);

// GET /api/ledger/by-document/:documentId — entries for a specific movement document
router.get('/by-document/:documentId', ledgerController.getLedgerByDocument);

module.exports = router;
