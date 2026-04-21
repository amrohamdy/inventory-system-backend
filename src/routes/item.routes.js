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

/**
 * @openapi
 * /items/import/preview:
 *   post:
 *     tags: [Items]
 *     summary: Upload an Excel/CSV and preview parsed rows before committing
 *     description: >
 *       Accepts .xlsx / .xls / .csv up to 10 MB. Returns parsed rows + per-row
 *       validation errors. The frontend then posts the approved rows to
 *       `/items/import/confirm`. The file lives only in memory (not persisted).
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: .xlsx / .xls / .csv
 *               asOpeningBalance:
 *                 type: string
 *                 enum: [true, false]
 *                 description: Treat quantity columns as Opening Balance (OB phase only)
 *     responses:
 *       200:
 *         description: Parsed rows + validation summary
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
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

/**
 * @openapi
 * /items/bulk-upload-images:
 *   post:
 *     tags: [Items]
 *     summary: Upload a ZIP of images and match them to items by barcode
 *     description: >
 *       Each file inside the ZIP is matched against `Item.barcode` (filename
 *       without extension = barcode). Matched images are persisted through the
 *       storage provider (R2 under `tenants/{tenantId}/items/...` or local
 *       `/uploads/items/...`). Unmatched files are returned in the response.
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: ZIP archive (max 50 MB) containing .jpg/.png/.webp/.gif files named after item barcodes
 *     responses:
 *       200:
 *         description: Bulk upload summary
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiSuccess'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         matched: { type: integer }
 *                         skipped: { type: integer }
 *                         errors:  { type: array, items: { type: object } }
 *                         details: { type: array, items: { type: object } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
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

/**
 * @openapi
 * /items/{id}/image:
 *   post:
 *     tags: [Items]
 *     summary: Upload or replace an item's primary image
 *     description: >
 *       Stored as the object key in `Item.imageUrl`. Under `STORAGE_DRIVER=r2`
 *       the key is `tenants/{tenantId}/items/{uuid}.{ext}` and should be
 *       resolved via `GET /files/signed-url` for display. Under `local` the
 *       key is a legacy `/uploads/items/...` path that works directly.
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [image]
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: .jpg, .jpeg, .png, .webp, or .gif (max 5 MB)
 *     responses:
 *       200:
 *         description: Updated item (with new imageUrl key)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ItemEnvelope' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
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
