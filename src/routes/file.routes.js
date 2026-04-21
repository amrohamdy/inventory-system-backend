'use strict';

const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { getStorage } = require('../config/storage');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * @openapi
 * /files/signed-url:
 *   get:
 *     tags: [Files]
 *     summary: Short-lived signed URL for a stored object
 *     description: >
 *       Tenant-scoped. The `key` must start with `tenants/{yourTenantId}/` — any
 *       other prefix returns 403. Legacy `/uploads/...` paths are served as-is.
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: key
 *         required: true
 *         schema: { type: string }
 *         description: Object key returned by an upload endpoint
 *       - in: query
 *         name: ttl
 *         required: false
 *         schema: { type: integer, minimum: 1 }
 *         description: Seconds until the URL expires (defaults to SIGNED_URL_TTL_SECONDS)
 *     responses:
 *       200:
 *         description: Signed URL ready to use as `<img src>` / `<a href>`
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SignedUrlResponse' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/signed-url', authenticate, async (req, res) => {
    const key = typeof req.query.key === 'string' ? req.query.key.trim() : '';
    if (!key) {
        return res.status(400).json({ success: false, message: 'key is required' });
    }

    // Allow legacy local-disk paths through unchanged.
    const isLegacy = key.startsWith('/uploads/');
    if (!isLegacy) {
        const expectedPrefix = `tenants/${req.user.tenantId}/`;
        if (!key.startsWith(expectedPrefix)) {
            logger.warn(
                `[file.routes] cross-tenant access denied user=${req.user.id} tenant=${req.user.tenantId} key=${key}`
            );
            return res.status(403).json({
                success: false,
                message: 'Access denied. File key does not belong to your tenant.',
            });
        }
    }

    const ttlRaw = parseInt(req.query.ttl, 10);
    const ttl = Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : undefined;

    try {
        const storage = getStorage();
        const url = await storage.getSignedUrl(key, ttl);
        // Must match whatever TTL the provider actually used — fall back to the
        // env default (604800 / 7 days) so `expiresAt` doesn't lie to the frontend
        // when the caller didn't pass a `ttl` query param.
        const envTtl = parseInt(process.env.SIGNED_URL_TTL_SECONDS, 10);
        const effectiveTtl = ttl || (Number.isFinite(envTtl) && envTtl > 0 ? envTtl : 604800);
        const expiresAt = new Date(Date.now() + effectiveTtl * 1000).toISOString();
        return res.json({ success: true, data: { url, expiresAt } });
    } catch (err) {
        logger.error(`[file.routes] signed-url failed key=${key} reason=${err.message}`);
        return res.status(500).json({
            success: false,
            message: 'Failed to generate signed URL',
        });
    }
});

module.exports = router;
