const express = require('express');
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/authenticate');
const {
    loginValidator,
    refreshValidator,
    changePasswordValidator,
    forgotPasswordValidator,
    resetPasswordValidator,
} = require('../utils/validators');

const router = express.Router();

// POST /api/auth/forgot-password
router.post('/forgot-password', forgotPasswordValidator, authController.forgotPassword);

// POST /api/auth/reset-password
router.post('/reset-password', resetPasswordValidator, authController.resetPassword);

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

// POST /api/auth/change-password (requires auth)
router.post('/change-password', authenticate, changePasswordValidator, authController.changePassword);

module.exports = router;
