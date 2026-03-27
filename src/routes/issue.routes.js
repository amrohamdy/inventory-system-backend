'use strict';
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { requirePermission } = require('../middleware/authorize');
const ctrl = require('../controllers/issue.controller');

router.use(authenticate);

router.post('/', requirePermission('ISSUE_CREATE'), ctrl.createIssue);
router.get('/', requirePermission('INVENTORY_VIEW'), ctrl.listIssues);
router.get('/:id', requirePermission('INVENTORY_VIEW'), ctrl.getIssue);
router.patch('/:id', requirePermission('ISSUE_CREATE'), ctrl.updateIssue); // DRAFT only
router.delete('/:id', requirePermission('ISSUE_CREATE'), ctrl.deleteIssue); // DRAFT only
router.post('/:id/post', requirePermission('ISSUE_CREATE'), ctrl.postIssue); // Atomic posting

module.exports = router;
