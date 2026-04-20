'use strict';

/**
 * Storage provider interface (JSDoc contract; not enforced at runtime).
 *
 * Every concrete provider (r2, local) must expose this surface so callers
 * can stay agnostic about where bytes physically live.
 *
 * Keys are tenant-scoped paths WITHOUT a leading slash, shaped like:
 *   tenants/{tenantId}/items/{uuid}.jpg
 *   tenants/{tenantId}/attachments/{docType}/{docId}/{uuid}.{ext}
 *
 * @typedef {Object} PutOptions
 * @property {string} [contentType]  MIME type, e.g. "image/jpeg".
 * @property {string} [originalName] Original filename (stored as metadata).
 *
 * @typedef {Object} StorageProvider
 * @property {string} driver
 *   Provider id ("r2" | "local"). Consumers can branch on this in edge cases.
 *
 * @property {(key: string, body: Buffer, opts?: PutOptions) => Promise<{key: string}>} put
 *   Upload bytes under `key`. Providers must not mutate `key`. Overwrites if key exists.
 *
 * @property {(key: string, ttlSeconds?: number) => Promise<string>} getSignedUrl
 *   Return a short-lived URL that serves the object. Local provider returns
 *   a server-relative path under /uploads/... (no TTL enforcement).
 *
 * @property {(key: string) => Promise<boolean>} delete
 *   Remove the object. Returns true if it existed, false otherwise. Never throws.
 *
 * @property {(key: string) => Promise<boolean>} exists
 *   Cheap HEAD-style existence check.
 */

module.exports = {};
