const express = require('express');
const { validate: uuidValidate } = require('uuid');
const router = express.Router();
const itemController = require('../controllers/item.controller');
const { authenticate: protect } = require('../middleware/authenticate');
const { requireAnyPermission, requirePermission } = require('../middleware/authorize');
const { uploadImage, uploadImport, uploadZip } = require('../middleware/upload.middleware');

// All item routes require authentication
router.use(protect);

// Reject non-UUID :id before Prisma (avoids P2000 on e.g. GET /items/check-requirements if routed as /:id)
router.param('id', (req, res, next, id) => {
    if (!uuidValidate(id)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid item id. Expected a UUID.',
        });
    }
    next();
});

// ── Template Download ────────────────────────────────────────────────────────
router.get(
    '/import/template',
    requirePermission('VIEW_MASTER_DATA'),
    itemController.downloadTemplate
);

router.get(
    '/export',
    requirePermission('VIEW_MASTER_DATA'),
    itemController.exportItems
);

// ── Import (must be before /:id to avoid route conflict) ─────────────────────
router.post(
    '/import/preview',
    requirePermission('MANAGE_IMPORTS'),
    uploadImport.single('file'),
    itemController.importPreview
);

router.post(
    '/import/confirm',
    requirePermission('MANAGE_IMPORTS'),
    itemController.importConfirm
);

router.post(
    '/bulk-upload-images',
    requirePermission('MANAGE_MASTER_DATA'),
    uploadZip.single('file'),
    itemController.bulkUploadImages
);

// ── Prerequisites for creating items (must be before /:id) ─────────────────────
router.get(
    '/check-requirements',
    requireAnyPermission('BASIC_DATA_VIEW', 'GET_PASS_VIEW'),
    itemController.checkItemCreationRequirements
);

// ── Collection routes ─────────────────────────────────────────────────────────
router.route('/')
    .post(requirePermission('MANAGE_MASTER_DATA'), itemController.createItem)
    .get(requirePermission('VIEW_MASTER_DATA'), itemController.getItems);

// ── Per-item routes ───────────────────────────────────────────────────────────
router.route('/:id')
    .get(requirePermission('VIEW_MASTER_DATA'), itemController.getItem)
    .put(requirePermission('MANAGE_MASTER_DATA'), itemController.updateItem)
    .delete(requirePermission('MANAGE_MASTER_DATA'), itemController.deleteItem);

// Image upload
router.post(
    '/:id/image',
    requirePermission('MANAGE_MASTER_DATA'),
    uploadImage.single('image'),
    itemController.uploadItemImage
);

// Toggle active/inactive
router.patch(
    '/:id/toggle-active',
    requirePermission('MANAGE_MASTER_DATA'),
    itemController.toggleActive
);

// ItemUnits
router.route('/:id/units')
    .get(requirePermission('VIEW_MASTER_DATA'), itemController.getItemUnits)
    .put(requirePermission('MANAGE_MASTER_DATA'), itemController.updateItemUnits);

module.exports = router;
