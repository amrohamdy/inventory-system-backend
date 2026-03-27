const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure uploads directories exist
const UPLOADS_DIR = path.join(__dirname, '../../uploads/items');
const IMPORT_DIR = path.join(__dirname, '../../uploads/imports');
const ATTACHMENT_DIR = path.join(__dirname, '../../uploads/attachments');

[UPLOADS_DIR, IMPORT_DIR, ATTACHMENT_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ── Item Image Storage ────────────────────────────────────────────────────────
const imageStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const name = `item-${req.params.id || Date.now()}-${Date.now()}${ext}`;
        cb(null, name);
    },
});

const imageFilter = (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed (jpg, jpeg, png, webp, gif)'));
    }
};

const uploadImage = multer({
    storage: imageStorage,
    fileFilter: imageFilter,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// ── Excel/CSV Import Storage ──────────────────────────────────────────────────
const importStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, IMPORT_DIR),
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `import-${Date.now()}${ext}`);
    },
});

const importFilter = (_req, file, cb) => {
    const allowed = ['.xlsx', '.xls', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Only Excel (.xlsx, .xls) or CSV files are allowed'));
    }
};

const uploadImport = multer({
    storage: importStorage,
    fileFilter: importFilter,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// ── Breakage Attachment Storage ───────────────────────────────────────────────
const attachmentStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, ATTACHMENT_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const base = path.basename(file.originalname, ext).replace(/[^a-z0-9]/gi, '_');
        cb(null, `attach-${req.params.id || 'doc'}-${Date.now()}-${base}${ext}`);
    },
});

const attachmentFilter = (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.docx', '.doc', '.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Attachment must be an image, PDF, Word, or Excel file.'));
};

const uploadAttachment = multer({
    storage: attachmentStorage,
    fileFilter: attachmentFilter,
    limits: { fileSize: 10 * 1024 * 1024 },
});

// ── ZIP Upload Storage ────────────────────────────────────────────────────────
const ZIP_DIR = path.join(__dirname, '../../uploads/temp-zip');
if (!fs.existsSync(ZIP_DIR)) fs.mkdirSync(ZIP_DIR, { recursive: true });

const zipStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, ZIP_DIR),
    filename: (_req, file, cb) => {
        cb(null, `zip-${Date.now()}${path.extname(file.originalname).toLowerCase()}`);
    },
});

const zipFilter = (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.zip') cb(null, true);
    else cb(new Error('Only ZIP files are allowed'));
};

const uploadZip = multer({
    storage: zipStorage,
    fileFilter: zipFilter,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

// Helper: delete a file safely
const deleteFile = (filePath) => {
    try {
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { /* ignore */ }
};

module.exports = { uploadImage, uploadImport, uploadAttachment, uploadZip, deleteFile, UPLOADS_DIR, ATTACHMENT_DIR };
