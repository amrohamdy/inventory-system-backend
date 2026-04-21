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

/**
 * @openapi
 * /auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Request a password reset OTP via email
 *     description: >
 *       Always returns 200 to avoid leaking which emails are registered. If the
 *       address matches a user, a 6-digit OTP is emailed via the queued mail
 *       service (EmailLog row inserted, attempted immediately).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *               tenantSlug: { type: string, description: "Optional — scopes the reset to a specific tenant" }
 *     responses:
 *       200:
 *         description: Reset code sent (or silently ignored)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiSuccess' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 */
router.post('/forgot-password', forgotPasswordValidator, authController.forgotPassword);

/**
 * @openapi
 * /auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Reset password using the OTP sent to the user's email
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, otp, newPassword]
 *             properties:
 *               email: { type: string, format: email }
 *               otp: { type: string, pattern: "^\\d{6}$", description: "6-digit code from the reset email" }
 *               newPassword: { type: string, format: password, minLength: 8 }
 *     responses:
 *       200:
 *         description: Password updated; existing sessions are invalidated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiSuccess' }
 *       400:
 *         description: Invalid / expired OTP, or weak password
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 */
router.post('/reset-password', resetPasswordValidator, authController.resetPassword);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Authenticate a user and return JWT tokens
 *     description: >
 *       Seeded demo accounts all use password `Admin@123` and tenantSlug
 *       `grand-horizon`. Use the returned `accessToken` in the Authorize dialog.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/LoginRequest' }
 *     responses:
 *       200:
 *         description: Tokens issued
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/LoginResponse' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401:
 *         description: Invalid email / password / tenantSlug combination
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 */
router.post('/login', loginValidator, authController.login);

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Exchange a refresh token for a new access token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/RefreshRequest' }
 *     responses:
 *       200:
 *         description: Fresh access + refresh tokens
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/LoginResponse' }
 *       401:
 *         description: Refresh token missing, expired, or revoked
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 */
router.post('/refresh', refreshValidator, authController.refresh);

// POST /api/auth/logout  (optionally authenticated — revoke token)
router.post('/logout', authController.logout);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Return the currently authenticated user's profile
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200:
 *         description: Current user
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiSuccess'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/UserProfile' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/me', authenticate, authController.me);

// POST /api/auth/switch-tenant (requires auth)
router.post('/switch-tenant', authenticate, authController.switchTenant);

// POST /api/auth/change-password (requires auth)
router.post('/change-password', authenticate, changePasswordValidator, authController.changePassword);

module.exports = router;
