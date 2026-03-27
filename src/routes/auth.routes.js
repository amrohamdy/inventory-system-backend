const express = require('express');
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/authenticate');
const { loginValidator, refreshValidator } = require('../utils/validators');

const router = express.Router();

// POST /api/auth/login
router.post('/login', loginValidator, authController.login);

// POST /api/auth/refresh
router.post('/refresh', refreshValidator, authController.refresh);

// POST /api/auth/logout  (optionally authenticated — revoke token)
router.post('/logout', authController.logout);

// GET /api/auth/me  (requires auth)
router.get('/me', authenticate, authController.me);

// POST /api/auth/switch-tenant (requires auth)
router.post('/switch-tenant', authenticate, authController.switchTenant);

module.exports = router;
