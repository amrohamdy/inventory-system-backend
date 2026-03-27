const express = require('express');
const router = express.Router();
const itemController = require('../controllers/item.controller');
const { authenticate: protect } = require('../middleware/authenticate');
const { requirePermission } = require('../middleware/authorize');
const { uploadImage, uploadImport, uploadZip } = require('../middleware/upload.middleware');

// All item routes require authentication
router.use(protect);

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
