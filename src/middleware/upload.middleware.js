'use strict';

/**
 * Upload middleware — memory-backed multer + storage-service pipe.
 *
 * Previous behavior: `multer.diskStorage` wrote directly to local `uploads/`
 * folders and controllers persisted the resulting `/uploads/...` path in the
 * DB. That breaks on ephemeral filesystems (Railway) and leaks files across
 * tenants (static mount has no auth).
 *
 * New behavior: files arrive as Buffers in `req.file.buffer` / `req.files[].buffer`.
 * Controllers then call `storage.put(key, buffer, {contentType, originalName})`
 * with a tenant-scoped key like `tenants/{tenantId}/items/{uuid}.jpg`.
 * The key (not a URL) is what gets stored in the DB. `/api/files/signed-url`
 * is used to render short-lived, tenant-validated download URLs.
 */

const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const { getStorage, isLocalDriver } = require('../config/storage');

const memoryStorage = multer.memoryStorage();

// ── Filters (mirror pre-existing mime/ext rules) ──────────────────────────────
const imageFilter = (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only image files are allowed (jpg, jpeg, png, webp, gif)'));
};

const importFilter = (_req, file, cb) => {
    const allowed = ['.xlsx', '.xls', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only Excel (.xlsx, .xls) or CSV files are allowed'));
};

const attachmentFilter = (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.docx', '.doc', '.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Attachment must be an image, PDF, Word, or Excel file.'));
};

const zipFilter = (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.zip') cb(null, true);
    else cb(new Error('Only ZIP files are allowed'));
};

const uploadImage = multer({
    storage: memoryStorage,
    fileFilter: imageFilter,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

const uploadImport = multer({
    storage: memoryStorage,
    fileFilter: importFilter,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

const uploadAttachment = multer({
    storage: memoryStorage,
    fileFilter: attachmentFilter,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

const uploadZip = multer({
    storage: memoryStorage,
    fileFilter: zipFilter,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

// ── Key builders ─────────────────────────────────────────────────────────────
// Under the local driver we keep the old `/uploads/.../xxx.ext` layout so that
// DB values stay byte-identical to pre-cloud behaviour (frontend <img src> keeps
// working unchanged). Under R2 we use tenant-scoped keys which the signed-URL
// endpoint validates against req.user.tenantId.
const extOf = (filename) => path.extname(filename || '').toLowerCase();
const uuid = () => crypto.randomUUID();

const buildItemImageKey = (tenantId, originalName, itemId) => {
    if (isLocalDriver()) {
        return `/uploads/items/item-${itemId || 'new'}-${Date.now()}${extOf(originalName)}`;
    }
    return `tenants/${tenantId}/items/${uuid()}${extOf(originalName)}`;
};

const buildAttachmentKey = (tenantId, docType, docId, originalName) => {
    const base = path.basename(originalName || '', extOf(originalName)).replace(/[^a-z0-9]/gi, '_');
    if (isLocalDriver()) {
        return `/uploads/attachments/attach-${docId || 'doc'}-${Date.now()}-${base}${extOf(originalName)}`;
    }
    return `tenants/${tenantId}/attachments/${docType}/${docId}/${uuid()}${extOf(originalName)}`;
};

const buildImportKey = (tenantId, originalName) => {
    if (isLocalDriver()) {
        return `/uploads/imports/import-${Date.now()}${extOf(originalName)}`;
    }
    return `tenants/${tenantId}/imports/${Date.now()}${extOf(originalName)}`;
};

const buildGrnPdfKey = (tenantId, grnId, originalName) => {
    const ext = extOf(originalName) || '.pdf';
    if (isLocalDriver()) {
        return `/uploads/attachments/grn-${grnId || 'new'}-${Date.now()}${ext}`;
    }
    return `tenants/${tenantId}/grn/${grnId || uuid()}-${Date.now()}${ext}`;
};

const buildDamagePhotoKey = (tenantId, getPassLineId, originalName) => {
    if (isLocalDriver()) {
        return `/uploads/attachments/damage-${getPassLineId || 'line'}-${Date.now()}${extOf(originalName)}`;
    }
    return `tenants/${tenantId}/damage-photos/${getPassLineId}/${uuid()}${extOf(originalName)}`;
};

const buildZipTempKey = (tenantId, originalName) => {
    if (isLocalDriver()) {
        return `/uploads/temp-zip/zip-${Date.now()}${extOf(originalName)}`;
    }
    return `tenants/${tenantId}/tmp/zip-${Date.now()}${extOf(originalName)}`;
};

const buildLogoKey = (tenantId, originalName) => {
    if (isLocalDriver()) {
        return `/uploads/branding/logo-${tenantId}-${Date.now()}${extOf(originalName)}`;
    }
    return `tenants/${tenantId}/branding/logo-${Date.now()}${extOf(originalName)}`;
};

// ── Helpers ─────────────────────────────────────────────────────────────────
/**
 * Persist an in-memory file via the configured storage provider.
 *
 * @param {string} key      Tenant-scoped object key (use a build* helper).
 * @param {Express.Multer.File} file  multer memoryStorage file object.
 * @returns {Promise<{key: string, size: number, mime: string, originalName: string}>}
 */
const putBuffer = async (key, file) => {
    const storage = getStorage();
    await storage.put(key, file.buffer, {
        contentType: file.mimetype,
        originalName: file.originalname,
    });
    return {
        key,
        size: file.size,
        mime: file.mimetype,
        originalName: file.originalname,
    };
};

/**
 * Best-effort delete. Accepts either a cloud key (tenants/...) or a legacy
 * `/uploads/...` path. Never throws.
 */
const deleteFile = async (keyOrPath) => {
    if (!keyOrPath) return false;
    try {
        const storage = getStorage();
        return await storage.delete(keyOrPath);
    } catch {
        return false;
    }
};

module.exports = {
    uploadImage,
    uploadImport,
    uploadAttachment,
    uploadZip,
    deleteFile,
    putBuffer,
    buildItemImageKey,
    buildAttachmentKey,
    buildImportKey,
    buildGrnPdfKey,
    buildDamagePhotoKey,
    buildZipTempKey,
    buildLogoKey,
};
