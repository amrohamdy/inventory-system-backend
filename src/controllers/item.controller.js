const itemService = require('../services/item.service');
const { success } = require('../utils/response');
const path = require('path');
const fs = require('fs');

// ── Always use relative path so frontend proxy (Vite /uploads) handles CORS ────
const getImageUrl = (_req, filename) => `/uploads/items/${filename}`;

// ── Create Item ───────────────────────────────────────────────────────────────
const createItem = async (req, res, next) => {
    try {
        const item = await itemService.createItem(req.body, req.user.tenantId);
        return success(res, item, 'Item created successfully', 201);
    } catch (err) { next(err); }
};

// ── List Items ────────────────────────────────────────────────────────────────
const getItems = async (req, res, next) => {
    try {
        const result = await itemService.getItems(req.user.tenantId, req.query);
        return success(res, result.items, 'Items fetched successfully', 200, {
            total: result.total,
            skip: parseInt(req.query.skip) || 0,
            take: parseInt(req.query.take) || 20,
        });
    } catch (err) { next(err); }
};

// ── Get Single Item ───────────────────────────────────────────────────────────
const getItem = async (req, res, next) => {
    try {
        const item = await itemService.getItemById(req.params.id, req.user.tenantId);
        return success(res, item, 'Item fetched successfully');
    } catch (err) { next(err); }
};

// ── Update Item ───────────────────────────────────────────────────────────────
const updateItem = async (req, res, next) => {
    try {
        const item = await itemService.updateItem(req.params.id, req.body, req.user.tenantId, req.user.id);
        const warnings = item._warnings || [];
        if (item._warnings) delete item._warnings;
        return success(res, item, warnings.length > 0 ? warnings[0] : 'Item updated successfully');
    } catch (err) { next(err); }
};

// ── Upload Item Image ─────────────────────────────────────────────────────────
const uploadItemImage = async (req, res, next) => {
    try {
        if (!req.file) {
            const e = new Error('No image file uploaded.'); e.statusCode = 400; throw e;
        }

        // Fetch current item to get old image path
        const current = await itemService.getItemById(req.params.id, req.user.tenantId);

        // Derive old absolute path from imageUrl if it was local
        let oldImagePath = null;
        if (current.imageUrl && current.imageUrl.includes('/uploads/items/')) {
            const filename = current.imageUrl.split('/uploads/items/').pop();
            oldImagePath = path.join(__dirname, '../../uploads/items', filename);
        }

        const imageUrl = getImageUrl(req, req.file.filename);
        const item = await itemService.updateItemImage(req.params.id, req.user.tenantId, imageUrl, oldImagePath);
        return success(res, item, 'Image uploaded successfully');
    } catch (err) {
        // Clean up uploaded file on error
        if (req.file?.path && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        next(err);
    }
};

// ── Delete Item ───────────────────────────────────────────────────────────────
const deleteItem = async (req, res, next) => {
    try {
        await itemService.deleteItem(req.params.id, req.user.tenantId);
        return success(res, null, 'Item deleted successfully');
    } catch (err) { next(err); }
};

// ── Toggle Active ─────────────────────────────────────────────────────────────
const toggleActive = async (req, res, next) => {
    try {
        const item = await itemService.toggleActive(req.params.id, req.user.tenantId);
        return success(res, item, `Item ${item.isActive ? 'activated' : 'deactivated'} successfully`);
    } catch (err) { next(err); }
};

// ── Get Item Units ────────────────────────────────────────────────────────────
const getItemUnits = async (req, res, next) => {
    try {
        const units = await itemService.getItemUnits(req.params.id, req.user.tenantId);
        return success(res, units, 'Item units fetched successfully');
    } catch (err) { next(err); }
};

// ── Update Item Units ─────────────────────────────────────────────────────────
const updateItemUnits = async (req, res, next) => {
    try {
        const units = await itemService.updateItemUnits(
            req.params.id,
            req.user.tenantId,
            req.body.itemUnits || []
        );
        return success(res, units, 'Item units updated successfully');
    } catch (err) { next(err); }
};

// ── Import: Parse & Preview ───────────────────────────────────────────────────
const importPreview = async (req, res, next) => {
    try {
        if (!req.file) {
            const e = new Error('No file uploaded.'); e.statusCode = 400; throw e;
        }
        const result = await itemService.parseImportFile(req.file.path, req.user.tenantId);
        // Store file path in session-like manner via response for confirm step
        return success(res, { ...result, filePath: req.file.path }, 'File parsed successfully');
    } catch (err) {
        if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        next(err);
    }
};

// ── Import: Confirm ───────────────────────────────────────────────────────────
const importConfirm = async (req, res, next) => {
    try {
        const { rows, filePath, asOpeningBalance } = req.body;
        if (!rows || !Array.isArray(rows)) {
            const e = new Error('Invalid import payload.'); e.statusCode = 400; throw e;
        }

        // If OB requested, validate eligibility first
        if (asOpeningBalance) {
            const settingService = require('../services/setting.service');
            const obCheck = await settingService.isOpeningBalanceAllowed(req.user.tenantId);
            if (!obCheck.allowed) {
                const e = new Error(obCheck.reason); e.statusCode = 403; throw e;
            }
        }

        const result = await itemService.confirmImport(rows, req.user.tenantId, req.user.id, !!asOpeningBalance);

        // Cleanup temp file
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);

        return success(res, result, `Import complete: ${result.inserted} inserted, ${result.updated} updated, ${result.failed} failed`);
    } catch (err) { next(err); }
};
// ── Bulk Upload Images (ZIP) ──────────────────────────────────────────────────
const bulkUploadImages = async (req, res, next) => {
    try {
        if (!req.file) {
            const e = new Error('No ZIP file uploaded.'); e.statusCode = 400; throw e;
        }
        const result = await itemService.bulkUploadImages(req.file.path, req.user.tenantId);
        return success(res, result, `Bulk upload complete: ${result.matched} matched, ${result.skipped} skipped`);
    } catch (err) {
        if (req.file?.path && fs.existsSync(req.file.path)) {
            try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
        }
        next(err);
    }
};

// ── Shared: Style a header row ────────────────────────────────────────────────
function _styleHeaderRow(sheet, columnCount) {
    const headerRow = sheet.getRow(1);
    headerRow.height = 22;
    for (let col = 1; col <= columnCount; col++) {
        const cell = headerRow.getCell(col);
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
            bottom: { style: 'thin', color: { argb: 'FF0D47A1' } },
        };
    }
    // Freeze header row
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    // Auto-filter on all columns
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnCount } };
}

// ── Export Items to Excel ─────────────────────────────────────────────────────
const exportItems = async (req, res, next) => {
    try {
        const ExcelJS = require('exceljs');
        const result = await itemService.getItems(req.user.tenantId, { ...req.query, take: 10000 });
        const items = result.items;

        const wb = new ExcelJS.Workbook();
        wb.creator = 'OS&E Cloud';
        wb.created = new Date();

        const ws = wb.addWorksheet('Items', {
            properties: { defaultColWidth: 18 },
        });

        // Define columns
        ws.columns = [
            { header: 'Item Name', key: 'name', width: 28 },
            { header: 'Barcode', key: 'barcode', width: 16 },
            { header: 'Department', key: 'department', width: 20 },
            { header: 'Category', key: 'category', width: 22 },
            { header: 'Default Store', key: 'store', width: 22 },
            { header: 'Vendor', key: 'vendor', width: 22 },
            { header: 'Base Unit', key: 'baseUnit', width: 14 },
            { header: 'Unit Price', key: 'unitPrice', width: 12 },
            { header: 'Description', key: 'description', width: 32 },
            { header: 'Status', key: 'status', width: 10 },
        ];

        // Add data rows
        items.forEach((item, idx) => {
            const baseUnit = item.itemUnits?.find(u => u.unitType === 'BASE');
            const row = ws.addRow({
                name: item.name,
                barcode: item.barcode || '',
                department: item.department?.name || '',
                category: item.category?.name || '',
                store: item.defaultStore?.name || '',
                vendor: item.supplier?.name || '',
                baseUnit: baseUnit ? `${baseUnit.unit?.name || ''} (${baseUnit.unit?.abbreviation || ''})` : '',
                unitPrice: parseFloat(item.unitPrice || 0),
                description: item.description || '',
                status: item.isActive ? 'Active' : 'Inactive',
            });
            // Alternating row color
            if (idx % 2 === 1) {
                row.eachCell({ includeEmpty: true }, (cell) => {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                });
            }
            // Format price column
            row.getCell('unitPrice').numFmt = '#,##0.00';
            row.getCell('unitPrice').alignment = { horizontal: 'right' };
        });

        // Style header
        _styleHeaderRow(ws, 10);

        // Write to buffer
        const buf = await wb.xlsx.writeBuffer();
        res.setHeader('Content-Disposition', `attachment; filename="Items_Export_${new Date().toISOString().split('T')[0]}.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(Buffer.from(buf));
    } catch (err) { next(err); }
};

// ── Download Import Template (.xlsx) ──────────────────────────────────────────
const downloadTemplate = async (req, res, next) => {
    try {
        const ExcelJS = require('exceljs');
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        const tenantId = req.user.tenantId;

        // Fetch lookup data
        const [categories, units, departments, locations, suppliers] = await Promise.all([
            prisma.category.findMany({ where: { tenantId, isActive: true }, select: { name: true } }),
            prisma.unit.findMany({ where: { tenantId, isActive: true }, select: { name: true, abbreviation: true } }),
            prisma.department.findMany({ where: { tenantId, isActive: true }, select: { name: true } }),
            prisma.location.findMany({ where: { tenantId, isActive: true }, select: { name: true }, orderBy: { name: 'asc' } }),
            prisma.supplier.findMany({ where: { tenantId, isActive: true }, select: { name: true }, orderBy: { name: 'asc' } }),
        ]);

        const wb = new ExcelJS.Workbook();
        wb.creator = 'OS&E Cloud';
        wb.created = new Date();

        // ── Sheet 1: Items Template ──
        const wsItems = wb.addWorksheet('Items', {
            properties: { defaultColWidth: 18 },
        });

        // Fixed columns + dynamic store columns
        const fixedColumns = [
            { header: 'Name', key: 'name', width: 28 },
            { header: 'Barcode', key: 'barcode', width: 16 },
            { header: 'Department', key: 'department', width: 20 },
            { header: 'Category', key: 'category', width: 22 },
            { header: 'Vendor', key: 'vendor', width: 22 },
            { header: 'Base Unit', key: 'baseUnit', width: 14 },
            { header: 'Unit Price', key: 'unitPrice', width: 12 },
        ];
        const FIXED_COL_COUNT = fixedColumns.length;

        // Dynamic store columns — one per active location
        const storeColumns = locations.map(loc => ({
            header: loc.name,
            key: `store__${loc.name}`,
            width: 14,
        }));

        wsItems.columns = [...fixedColumns, ...storeColumns];
        const totalColumns = FIXED_COL_COUNT + storeColumns.length;

        // Example row with sample store quantities
        const exRowData = {
            name: 'King Bed Sheet Set',
            barcode: 'OSE-001',
            department: departments[0]?.name || 'Housekeeping',
            category: categories[0]?.name || 'Linen & Textiles',
            vendor: suppliers[0]?.name || '',
            baseUnit: 'Each',
            unitPrice: 85.00,
        };
        locations.forEach((loc, i) => {
            exRowData[`store__${loc.name}`] = i < 2 ? (i === 0 ? 50 : 20) : '';
        });

        const exRow = wsItems.addRow(exRowData);
        exRow.eachCell({ includeEmpty: true }, (cell) => {
            cell.font = { italic: true, color: { argb: 'FF6B7280' } };
        });

        // Style fixed header columns (blue)
        _styleHeaderRow(wsItems, FIXED_COL_COUNT);

        // Style store header columns (green) to distinguish them
        const headerRow = wsItems.getRow(1);
        for (let col = FIXED_COL_COUNT + 1; col <= totalColumns; col++) {
            const cell = headerRow.getCell(col);
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            cell.border = { bottom: { style: 'thin', color: { argb: 'FF1B5E20' } } };
        }

        // ── Sheet 2: Reference Data ──
        const wsRef = wb.addWorksheet('Reference', {
            properties: { defaultColWidth: 22 },
        });

        wsRef.columns = [
            { header: 'Available Departments', key: 'dept', width: 24 },
            { header: 'Available Categories', key: 'cat', width: 26 },
            { header: 'Available Vendors', key: 'vendor', width: 26 },
            { header: 'Available Stores (Qty Columns)', key: 'loc', width: 28 },
            { header: 'Available Units', key: 'unit', width: 22 },
        ];

        const maxRows = Math.max(categories.length, units.length, departments.length, locations.length, suppliers.length, 1);
        for (let i = 0; i < maxRows; i++) {
            wsRef.addRow({
                dept: departments[i]?.name || '',
                cat: categories[i]?.name || '',
                vendor: suppliers[i]?.name || '',
                loc: locations[i]?.name || '',
                unit: units[i] ? `${units[i].name} (${units[i].abbreviation})` : '',
            });
        }

        _styleHeaderRow(wsRef, 5);

        // ── Data Validation (Dropdowns) ──
        const VALIDATION_ROWS = 100;
        const deptList = departments.map(d => d.name).filter(Boolean);
        const catList = categories.map(c => c.name).filter(Boolean);
        const unitList = units.map(u => `${u.name} (${u.abbreviation})`).filter(Boolean);
        const vendorList = suppliers.map(s => s.name).filter(Boolean);

        const validationConfig = [
            { col: 'department', list: deptList },
            { col: 'category', list: catList },
            { col: 'vendor', list: vendorList },
            { col: 'baseUnit', list: unitList },
        ];

        for (const { col, list } of validationConfig) {
            if (list.length === 0) continue;
            const colIdx = wsItems.getColumn(col).number;
            for (let row = 2; row <= VALIDATION_ROWS; row++) {
                wsItems.getCell(row, colIdx).dataValidation = {
                    type: 'list',
                    allowBlank: true,
                    formulae: [`"${list.join(',')}"`],
                    showErrorMessage: true,
                    errorTitle: 'Invalid Value',
                    error: 'Please select a value from the dropdown list.',
                };
            }
        }

        // Number format for store quantity columns
        for (let col = FIXED_COL_COUNT + 1; col <= totalColumns; col++) {
            for (let row = 2; row <= VALIDATION_ROWS; row++) {
                wsItems.getCell(row, col).numFmt = '#,##0';
            }
        }

        // Freeze header + first column
        wsItems.views = [{ state: 'frozen', ySplit: 1, xSplit: 1 }];
        wsItems.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: totalColumns } };

        // Write to buffer
        const buf = await wb.xlsx.writeBuffer();
        res.setHeader('Content-Disposition', 'attachment; filename="Item_Import_Template.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(Buffer.from(buf));
    } catch (err) { next(err); }
};

module.exports = {
    createItem,
    getItems,
    getItem,
    updateItem,
    uploadItemImage,
    deleteItem,
    toggleActive,
    getItemUnits,
    updateItemUnits,
    importPreview,
    importConfirm,
    bulkUploadImages,
    downloadTemplate,
    exportItems,
};
