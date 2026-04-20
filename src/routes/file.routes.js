'use strict';

const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { getStorage } = require('../config/storage');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/files/signed-url?key=<object-key>
 *
 * Returns a short-lived, server-side-signed URL for the given storage key.
 * The caller (frontend) uses this URL directly as `<img src>` / `<a href>`.
 *
 * Tenant isolation: the key MUST start with `tenants/{req.user.tenantId}/`.
 * Legacy `/uploads/...` paths are accepted as-is (they pre-date tenant scoping
 * and are served by `express.static` when STORAGE_DRIVER=local).
 *
 * Query params:
 *   - key (required): the object key stored in DB
 *   - ttl (optional): seconds, capped by provider defaults
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
        const expiresAt = new Date(Date.now() + (ttl || 900) * 1000).toISOString();
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
