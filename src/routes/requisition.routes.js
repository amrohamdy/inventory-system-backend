'use strict';
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const ctrl = require('../controllers/requisition.controller');

router.use(authenticate);

// CRUD
router.post('/', ctrl.createRequisition);
router.get('/', ctrl.listRequisitions);
router.get('/:id', ctrl.getRequisition);
router.patch('/:id', ctrl.updateRequisition);   // DRAFT only → 423 otherwise
router.delete('/:id', ctrl.deleteRequisition);   // DRAFT only → 423 otherwise

// State machine
router.post('/:id/submit', ctrl.submitRequisition);
router.post('/:id/approve', ctrl.approveRequisition); // MANAGER guard in controller
router.post('/:id/reject', ctrl.rejectRequisition);  // MANAGER guard in controller

module.exports = router;
