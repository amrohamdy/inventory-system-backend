const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/department.controller');
const { authenticate } = require('../middleware/authenticate');
const { requirePermission } = require('../middleware/authorize');

router.use(authenticate);

router.route('/')
    .post(requirePermission('BASIC_DATA_EDIT'), ctrl.createDepartment)
    .get(ctrl.getDepartments);

router.route('/:id')
    .get(ctrl.getDepartment)
    .put(requirePermission('BASIC_DATA_EDIT'), ctrl.updateDepartment)
    .delete(requirePermission('BASIC_DATA_EDIT'), ctrl.deleteDepartment);

router.patch('/:id/toggle', requirePermission('BASIC_DATA_EDIT'), ctrl.toggleDepartment);

module.exports = router;
