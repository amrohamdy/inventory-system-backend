const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { requirePermission } = require('../middleware/authorize');
const rolesController = require('../controllers/roles.controller');

router.use(authenticate);

router.get('/', requirePermission('USERS_COMPANY_MANAGE'), rolesController.listRoles);

module.exports = router;
