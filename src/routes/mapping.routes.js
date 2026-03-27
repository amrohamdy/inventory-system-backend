'use strict';
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const ctrl = require('../controllers/mapping.controller');

router.use(authenticate);

// ── Item Mappings ──
router.get('/items', ctrl.listItemMappings);
router.post('/items', ctrl.upsertItemMapping);   // FINANCE only

// ── UOM Mappings ──
router.get('/uom', ctrl.listUomMappings);
router.post('/uom', ctrl.upsertUomMapping);    // FINANCE only

// ── Vendor Mappings ──
router.get('/vendors', ctrl.listVendorMappings);
router.post('/vendors', ctrl.upsertVendorMapping); // FINANCE only
router.get('/vendors/unmatched', ctrl.getUnmatchedVendors);

// ── Re-apply all mappings to a GRN (after saving new mappings) ──
router.post('/apply-to-grn/:grnId', ctrl.applyMappingsToGrn);

module.exports = router;
