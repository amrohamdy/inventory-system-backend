const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { requireSuperAdmin } = require('../middleware/requireSuperAdmin');
const { updateOrganizationValidator } = require('../utils/validators');
const ctrl = require('../controllers/organization.controller');

router.use(authenticate, requireSuperAdmin);

router.patch('/:id', updateOrganizationValidator, ctrl.updateOrganization);

module.exports = router;
