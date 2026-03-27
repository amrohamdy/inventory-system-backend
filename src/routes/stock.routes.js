const express = require('express');
const router = express.Router();
const stockController = require('../controllers/stock.controller');
const { authenticate: protect } = require('../middleware/authenticate');

router.use(protect);

router.get('/summary', stockController.getStockSummary);
router.get('/export', stockController.exportStockBalances);
router.get('/', stockController.getStockBalances);
router.get('/:itemId', stockController.getItemStockProfile);

module.exports = router;
