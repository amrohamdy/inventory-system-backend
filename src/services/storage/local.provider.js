'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');

const UPLOADS_ROOT = path.join(__dirname, '../../../uploads');

/**
 * Dev fallback that keeps bytes on the local filesystem under `uploads/`.
 *
 * Key → path rules:
 *   - Keys with a leading slash starting "/uploads/" are legacy values from
 *     the old multer diskStorage layout; they are written/read as-is (after
 *     stripping the "/uploads/" prefix) for zero-breakage during migration.
 *   - All other keys are written under `uploads/<key>`.
 *
 * `getSignedUrl` returns a server-relative URL (`/uploads/...`) since the
 * `express.static` mount in server.js serves these when STORAGE_DRIVER=local.
 */

const ensureDir = (fullPath) => {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
};

const keyToPath = (key) => {
    const normalized = key.startsWith('/uploads/') ? key.replace(/^\/uploads\//, '') : key;
    return path.join(UPLOADS_ROOT, normalized);
};

const keyToUrl = (key) => (key.startsWith('/uploads/') ? key : `/uploads/${key}`);

const createLocalProvider = () => ({
    driver: 'local',

    async put(key, body, opts = {}) {
        const full = keyToPath(key);
        ensureDir(full);
        await fs.promises.writeFile(full, body);
        return { key };
    },

    async getSignedUrl(key /* , ttlSeconds */) {
        return keyToUrl(key);
    },

    async delete(key) {
        const full = keyToPath(key);
        try {
            await fs.promises.unlink(full);
            return true;
        } catch (err) {
            if (err.code === 'ENOENT') return false;
            logger.warn(`[storage.local] delete failed key=${key} reason=${err.message}`);
            return false;
        }
    },

    async exists(key) {
        const full = keyToPath(key);
        try {
            await fs.promises.access(full, fs.constants.F_OK);
            return true;
        } catch {
            return false;
        }
    },
});

module.exports = { createLocalProvider, UPLOADS_ROOT };
