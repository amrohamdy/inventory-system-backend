const itemService = require('../services/item.service');
const { success } = require('../utils/response');
const { randomUUID } = require('crypto');
const {
    putBuffer,
    deleteFile,
    buildItemImageKey,
} = require('../middleware/upload.middleware');

const IMPORT_PREVIEW_TTL_MS = 30 * 60 * 1000; // 30 minutes
const importPreviewCache = new Map();

const buildImportPreviewToken = () => `import-preview://${randomUUID()}`;

const storeImportPreview = ({ tenantId, rows, asOpeningBalance }) => {
    const filePath = buildImportPreviewToken();
    importPreviewCache.set(filePath, {
        tenantId,
        rows,
        asOpeningBalance: !!asOpeningBalance,
        createdAt: Date.now(),
    });
    return filePath;
};

const resolveImportPreview = ({ filePath, tenantId }) => {
    const cached = importPreviewCache.get(filePath);
    if (!cached) return null;
    if (cached.tenantId !== tenantId) return null;
    if (Date.now() - cached.createdAt > IMPORT_PREVIEW_TTL_MS) {
        importPreviewCache.delete(filePath);
        return null;
    }
    return cached;
};

// ── Item Master prerequisites (canCreateItem vs isOpeningBalanceAllowed) ───────
const checkItemCreationRequirements = async (req, res, next) => {
    try {
        const result = await itemService.checkItemCreationRequirements(req.user.tenantId);
        return success(res, result, 'Item creation requirements checked');
    } catch (err) { next(err); }
};

// ── Create Item ───────────────────────────────────────────────────────────────
const createItem = async (req, res, next) => {
    try {
        const item = await itemService.createItem(req.body, req.user.tenantId, req.user.id);
        return success(res, item, 'Item created successfully', 201);
    } catch (err) { next(err); }
};

// ── List Items ────────────────────────────────────────────────────────────────
const getItems = async (req, res, next) => {
    try {
        const result = await itemService.getItems(req.user.tenantId, req.query);
        if (result.slim) {
            return success(res, result.items, 'Items fetched successfully', 200);
        }
        return success(res, result.items, 'Items fetched successfully', 200, {
            total: result.total,
            skip: result.skip,
            take: result.take,
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

        const current = await itemService.getItemById(req.params.id, req.user.tenantId);
        const oldKey = current.imageUrl || null;

        const key = buildItemImageKey(req.user.tenantId, req.file.originalname, req.params.id);
        await putBuffer(key, req.file);

        const item = await itemService.updateItemImage(req.params.id, req.user.tenantId, key, oldKey);
        return success(res, item, 'Image uploaded successfully');
    } catch (err) {
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
// With memory-backed multer the file lives in `req.file.buffer`; the preview
// step parses it in-memory. We cache parsed rows behind a temporary `filePath`
// token so V2 clients can confirm using { filePath }.
const importPreview = async (req, res, next) => {
    try {
        if (!req.file) {
            const e = new Error('No file uploaded.'); e.statusCode = 400; throw e;
        }
        const asOpeningBalance = String(req.body?.asOpeningBalance ?? req.query?.asOpeningBalance ?? '').toLowerCase() === 'true';
        const result = await itemService.parseImportFile(req.file.buffer, req.user.tenantId, { asOpeningBalance });
        const filePath = storeImportPreview({
            tenantId: req.user.tenantId,
            rows: result.preview,
            asOpeningBalance,
        });
        result.filePath = filePath;
        return success(res, result, 'File parsed successfully');
    } catch (err) {
        next(err);
    }
};

// ── Import: Confirm ───────────────────────────────────────────────────────────
const importConfirm = async (req, res, next) => {
    try {
        const { rows, filePath, asOpeningBalance } = req.body || {};

        let rowsToConfirm = Array.isArray(rows) ? rows : null;
        let asOpeningBalanceFinal = !!asOpeningBalance;

        if (!rowsToConfirm && filePath) {
            const cached = resolveImportPreview({ filePath, tenantId: req.user.tenantId });
            if (!cached) {
                const e = new Error('Import preview has expired or is invalid. Please upload the file again.');
                e.statusCode = 400;
                throw e;
            }
            rowsToConfirm = cached.rows;
            if (asOpeningBalance === undefined || asOpeningBalance === null) {
                asOpeningBalanceFinal = !!cached.asOpeningBalance;
            }
        }

        if (!rowsToConfirm || !Array.isArray(rowsToConfirm)) {
            const e = new Error('Invalid import payload. Provide either rows or filePath.');
            e.statusCode = 400;
            throw e;
        }

        const result = await itemService.confirmImport(rowsToConfirm, req.user.tenantId, req.user.id, asOpeningBalanceFinal);
        return success(res, result, `Import complete: ${result.inserted} inserted, ${result.updated} updated, ${result.failed} failed`);
    } catch (err) { next(err); }
};
// ── Bulk Upload Images (ZIP) ──────────────────────────────────────────────────
const bulkUploadImages = async (req, res, next) => {
    try {
        if (!req.file) {
            const e = new Error('No ZIP file uploaded.'); e.statusCode = 400; throw e;
        }
        const result = await itemService.bulkUploadImages(req.file.buffer, req.user.tenantId);
        return success(res, result, `Bulk upload complete: ${result.matched} matched, ${result.skipped} skipped`);
    } catch (err) {
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
        const { slim: _slim, ...exportQuery } = req.query;
        const result = await itemService.getItems(req.user.tenantId, { ...exportQuery, take: 10000 });
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
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    try {
        const ExcelJS = require('exceljs');
        const tenantId = req.user.tenantId;

        // Fetch lookup data — store columns and Reference sheet use only this data
        const [categories, units, departments, locations, suppliers] = await Promise.all([
            prisma.category.findMany({ where: { tenantId, isActive: true }, select: { name: true }, orderBy: { name: 'asc' } }),
            prisma.unit.findMany({ where: { tenantId, isActive: true }, select: { name: true, abbreviation: true }, orderBy: { name: 'asc' } }),
            prisma.department.findMany({ where: { tenantId, isActive: true }, select: { name: true }, orderBy: { name: 'asc' } }),
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

        // Optional example row: only tenant lookup values (no hardcoded demo labels)
        const firstUnitLabel = units[0]
            ? `${units[0].name} (${units[0].abbreviation})`
            : '';
        const exRowData = {
            name: '',
            department: departments[0]?.name ?? '',
            category: categories[0]?.name ?? '',
            vendor: suppliers[0]?.name ?? '',
            baseUnit: firstUnitLabel,
            unitPrice: '',
        };
        locations.forEach((loc) => {
            exRowData[`store__${loc.name}`] = '';
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

        const maxRows = Math.max(categories.length, units.length, departments.length, locations.length, suppliers.length, 0);
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
            { col: 'department', list: deptList, formula: `Reference!$A$2:$A$${departments.length + 1}` },
            { col: 'category', list: catList, formula: `Reference!$B$2:$B$${categories.length + 1}` },
            { col: 'vendor', list: vendorList, formula: `Reference!$C$2:$C$${suppliers.length + 1}` },
            { col: 'baseUnit', list: unitList, formula: `Reference!$E$2:$E$${units.length + 1}` },
        ];

        for (const { col, list, formula } of validationConfig) {
            if (list.length === 0) continue;
            const colIdx = wsItems.getColumn(col).number;
            for (let row = 2; row <= VALIDATION_ROWS; row++) {
                wsItems.getCell(row, colIdx).dataValidation = {
                    type: 'list',
                    allowBlank: true,
                    formulae: [formula],
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
    } catch (err) {
        next(err);
    } finally {
        await prisma.$disconnect();
    }
};

module.exports = {
    checkItemCreationRequirements,
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
