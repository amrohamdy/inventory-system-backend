const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const XLSX = require('xlsx');
const path = require('path');
const auditService = require('./audit.service');

// ── Helpers ────────────────────────────────────────────────────────────────────

const ITEM_INCLUDE = {
    department: { select: { id: true, name: true, code: true } },
    category: { select: { id: true, name: true } },
    subcategory: { select: { id: true, name: true } },
    supplier: { select: { id: true, name: true } },
    defaultStore: { select: { id: true, name: true, departmentId: true } },
    itemUnits: { include: { unit: { select: { id: true, name: true, abbreviation: true } } } },
    stockBalances: { select: { qtyOnHand: true, location: { select: { id: true, name: true } } } },
};

// ── Store relative image path — Vite proxy (/uploads) handles CORS in dev ─────
const toRelativeImageUrl = (relativePath) => relativePath;

const notFound = (msg = 'Item not found') => {
    const e = new Error(msg);
    e.statusCode = 404;
    return e;
};

const badRequest = (msg) => {
    const e = new Error(msg);
    e.statusCode = 400;
    return e;
};

// ── Validate itemUnits array ───────────────────────────────────────────────────
// Each entry: { unitId, unitType: 'BASE'|'PURCHASE'|'ISSUE', conversionRate }
const validateItemUnits = (itemUnits) => {
    if (!itemUnits || itemUnits.length === 0) return;

    const types = itemUnits.map(u => u.unitType);

    // Only one BASE unit allowed
    const baseCount = types.filter(t => t === 'BASE').length;
    if (baseCount > 1) throw badRequest('Only one BASE unit is allowed per item.');

    // Validate conversion rates
    for (const u of itemUnits) {
        const rate = parseFloat(u.conversionRate);
        if (isNaN(rate) || rate <= 0) {
            throw badRequest(`Conversion rate must be a positive number. Got: ${u.conversionRate}`);
        }
        if (!['BASE', 'PURCHASE', 'ISSUE'].includes(u.unitType)) {
            throw badRequest(`Invalid unitType "${u.unitType}". Must be BASE, PURCHASE, or ISSUE.`);
        }
    }
};

// ── CREATE ─────────────────────────────────────────────────────────────────────
const createItem = async (data, tenantId) => {
    const { itemUnits, ...mainData } = data;

    validateItemUnits(itemUnits);

    // Department validation (required)
    if (mainData.departmentId) {
        const dept = await prisma.department.findFirst({ where: { id: mainData.departmentId, tenantId } });
        if (!dept) throw badRequest('Department not found in this tenant.');
    }

    // Category existence check (required)
    if (mainData.categoryId) {
        const cat = await prisma.category.findFirst({ where: { id: mainData.categoryId, tenantId } });
        if (!cat) throw badRequest('Category not found in this tenant.');
    }

    // Default Store validation — must belong to selected department
    if (mainData.defaultStoreId) {
        const store = await prisma.location.findFirst({ where: { id: mainData.defaultStoreId, tenantId } });
        if (!store) throw badRequest('Default store not found.');
        if (mainData.departmentId && store.departmentId && store.departmentId !== mainData.departmentId) {
            throw badRequest('Default store does not belong to the selected department.');
        }
    }

    // Auto-generate barcode
    const finalBarcode = mainData.barcode || Math.floor(100000000000 + Math.random() * 900000000000).toString();

    // Uniqueness checks
    const [dupBarcode, dupName] = await Promise.all([
        prisma.item.findFirst({ where: { barcode: finalBarcode, tenantId } }),
        prisma.item.findFirst({ where: { name: mainData.name, tenantId } }),
    ]);

    if (dupBarcode) throw badRequest(`Barcode '${finalBarcode}' already exists in this tenant.`);
    if (dupName) throw badRequest(`Item name '${mainData.name}' already exists.`);

    return prisma.item.create({
        data: {
            ...mainData,
            barcode: finalBarcode,
            tenantId,
            ...(itemUnits?.length > 0 && {
                itemUnits: {
                    create: itemUnits.map(u => ({
                        unitId: u.unitId,
                        unitType: u.unitType,
                        conversionRate: u.conversionRate,
                        isDefault: u.unitType === 'BASE',
                        tenantId,
                    })),
                },
            }),
        },
        include: ITEM_INCLUDE,
    });
};

// ── LIST ───────────────────────────────────────────────────────────────────────
const getItems = async (tenantId, query = {}) => {
    const { skip = 0, take = 20, search, categoryId, subcategoryId, departmentId, locationId, isActive } = query;

    const where = {
        tenantId,
        ...(categoryId && { categoryId }),
        ...(subcategoryId && { subcategoryId }),
        ...(departmentId && { departmentId }),
        ...(locationId && { stockBalances: { some: { locationId } } }),
        ...(isActive !== undefined && { isActive: isActive === 'true' }),
        ...(search && {
            OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { barcode: { contains: search, mode: 'insensitive' } },
                // Note: department is a relation — search on its name field
                { department: { name: { contains: search, mode: 'insensitive' } } },
            ],
        }),
    };

    const [items, total] = await Promise.all([
        prisma.item.findMany({
            where,
            skip: parseInt(skip),
            take: parseInt(take),
            orderBy: { name: 'asc' },
            include: ITEM_INCLUDE,
        }),
        prisma.item.count({ where }),
    ]);

    return { items, total };
};

// ── GET BY ID ──────────────────────────────────────────────────────────────────
const getItemById = async (id, tenantId) => {
    const item = await prisma.item.findFirst({
        where: { id, tenantId },
        include: {
            ...ITEM_INCLUDE,
            stockBalances: { include: { location: { select: { id: true, name: true } } } },
        },
    });
    if (!item) throw notFound();
    return item;
};

// ── Whitelist of scalar fields allowed in Item update ──────────────────────────
const ITEM_SCALAR_FIELDS = new Set([
    'name', 'description', 'departmentId', 'categoryId', 'subcategoryId',
    'supplierId', 'defaultStoreId', 'barcode', 'unitPrice', 'imageUrl',
    'reorderPoint', 'reorderQty', 'isActive',
]);

// ── UPDATE ─────────────────────────────────────────────────────────────────────
const updateItem = async (id, data, tenantId, userId = null) => {
    const existing = await getItemById(id, tenantId);

    const { itemUnits, ...rawData } = data;

    // Strip out relation objects and non-scalar fields to avoid Prisma errors
    const mainData = {};
    for (const key of Object.keys(rawData)) {
        if (ITEM_SCALAR_FIELDS.has(key)) {
            mainData[key] = rawData[key];
        }
    }

    if (mainData.categoryId) {
        const cat = await prisma.category.findFirst({ where: { id: mainData.categoryId, tenantId } });
        if (!cat) throw badRequest('Category not found in this tenant.');
    }

    if (mainData.departmentId) {
        const dept = await prisma.department.findFirst({ where: { id: mainData.departmentId, tenantId } });
        if (!dept) throw badRequest('Department not found in this tenant.');
    }

    // Validate store belongs to department
    const storeId = mainData.defaultStoreId || existing.defaultStoreId;
    const deptId = mainData.departmentId || existing.departmentId;
    if (storeId && deptId) {
        const store = await prisma.location.findFirst({ where: { id: storeId, tenantId } });
        if (store && store.departmentId && store.departmentId !== deptId) {
            throw badRequest('Default store does not belong to the selected department.');
        }
    }

    if (mainData.name) {
        const dup = await prisma.item.findFirst({ where: { name: mainData.name, tenantId, id: { not: id } } });
        if (dup) throw badRequest(`Item name '${mainData.name}' already exists.`);
    }

    if (mainData.barcode) {
        const dup = await prisma.item.findFirst({ where: { barcode: mainData.barcode, tenantId, id: { not: id } } });
        if (dup) throw badRequest(`Barcode '${mainData.barcode}' already exists in this tenant.`);
    }

    // ── Unit Structure Lock ──────────────────────────────────────────────────
    // Block ALL unit modifications if stock > 0 in any location.
    // Protects inventory valuation integrity and historical quantity interpretation.
    if (itemUnits !== undefined) {
        validateItemUnits(itemUnits);

        // Check if units actually changed
        const existingUnits = await prisma.itemUnit.findMany({ where: { itemId: id } });
        const unitsChanged = _haveUnitsChanged(existingUnits, itemUnits);

        if (unitsChanged) {
            const activeStock = await prisma.stockBalance.count({
                where: { itemId: id, qtyOnHand: { gt: 0 } },
            });
            if (activeStock > 0) {
                throw badRequest(
                    'Cannot modify item units while stock exists. '
                    + 'Please zero out stock via adjustment/count or create a new item.'
                );
            }
        }
    }

    const result = await prisma.$transaction(async (tx) => {
        // Replace units if provided
        if (itemUnits !== undefined) {
            await tx.itemUnit.deleteMany({ where: { itemId: id } });
            if (itemUnits.length > 0) {
                await tx.itemUnit.createMany({
                    data: itemUnits.map(u => ({
                        itemId: id,
                        unitId: u.unitId,
                        unitType: u.unitType,
                        conversionRate: u.conversionRate,
                        isDefault: u.unitType === 'BASE',
                        tenantId,
                    })),
                });
            }
        }

        if (Object.keys(mainData).length > 0) {
            return tx.item.update({
                where: { id },
                data: mainData,
                include: ITEM_INCLUDE,
            });
        }

        return tx.item.findFirst({ where: { id, tenantId }, include: ITEM_INCLUDE });
    });

    return result;
};

// ── Helper: Check if item units actually changed ──────────────────────────────
function _haveUnitsChanged(existingUnits, newUnits) {
    if (existingUnits.length !== newUnits.length) return true;
    const normalize = (u) => `${u.unitId}|${u.unitType}|${Number(u.conversionRate)}`;
    const existingSet = new Set(existingUnits.map(normalize));
    return newUnits.some(u => !existingSet.has(normalize(u)));
}

// ── UPDATE IMAGE ───────────────────────────────────────────────────────────────
const updateItemImage = async (id, tenantId, imageUrl, oldImagePath) => {
    const { deleteFile } = require('../middleware/upload.middleware');

    // Delete old image if it exists locally
    if (oldImagePath) deleteFile(oldImagePath);

    return prisma.item.update({
        where: { id },
        data: { imageUrl },
        include: ITEM_INCLUDE,
    });
};

// ── SOFT DELETE ────────────────────────────────────────────────────────────────
const deleteItem = async (id, tenantId) => {
    await getItemById(id, tenantId);

    const stockCount = await prisma.stockBalance.count({
        where: { itemId: id, qtyOnHand: { gt: 0 } },
    });
    if (stockCount > 0) throw badRequest('Cannot delete item: active stock exists. Deactivate instead.');

    return prisma.item.delete({ where: { id } });
};

// ── TOGGLE ACTIVE ──────────────────────────────────────────────────────────────
const toggleActive = async (id, tenantId) => {
    const item = await getItemById(id, tenantId);
    return prisma.item.update({
        where: { id },
        data: { isActive: !item.isActive },
        include: ITEM_INCLUDE,
    });
};

// ── GET ITEM UNITS ─────────────────────────────────────────────────────────────
const getItemUnits = async (id, tenantId) => {
    await getItemById(id, tenantId);
    return prisma.itemUnit.findMany({
        where: { itemId: id },
        include: { unit: { select: { id: true, name: true, abbreviation: true } } },
        orderBy: { unitType: 'asc' },
    });
};

// ── UPDATE ITEM UNITS ──────────────────────────────────────────────────────────
const updateItemUnits = async (id, tenantId, itemUnits) => {
    await getItemById(id, tenantId);
    validateItemUnits(itemUnits);

    return prisma.$transaction(async (tx) => {
        await tx.itemUnit.deleteMany({ where: { itemId: id } });
        if (itemUnits.length > 0) {
            await tx.itemUnit.createMany({
                data: itemUnits.map(u => ({
                    itemId: id,
                    unitId: u.unitId,
                    unitType: u.unitType,
                    conversionRate: u.conversionRate,
                    isDefault: u.unitType === 'BASE',
                    tenantId,
                })),
            });
        }
        return tx.itemUnit.findMany({
            where: { itemId: id },
            include: { unit: { select: { id: true, name: true, abbreviation: true } } },
        });
    });
};

// ── EXCEL IMPORT: PARSE & PREVIEW ─────────────────────────────────────────────
const parseImportFile = async (filePath, tenantId) => {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (rows.length === 0) throw badRequest('The uploaded file has no data rows.');
    if (rows.length > 1000) throw badRequest('Maximum 1000 rows per import.');

    // Fetch lookup data once
    const [categories, units, departments, locations, suppliers] = await Promise.all([
        prisma.category.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true } }),
        prisma.unit.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true } }),
        prisma.department.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true } }),
        prisma.location.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true, departmentId: true } }),
        prisma.supplier.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true } }),
    ]);

    const catMap = new Map(categories.map(c => [c.name.toLowerCase(), c.id]));
    const unitMap = new Map(units.map(u => [u.name.toLowerCase(), u.id]));
    const deptMap = new Map(departments.map(d => [d.name.toLowerCase(), d.id]));
    const locMap = new Map(locations.map(l => [l.name.toLowerCase(), { id: l.id, departmentId: l.departmentId }]));
    const supplierMap = new Map(suppliers.map(s => [s.name.toLowerCase(), s.id]));

    // Detect fixed vs dynamic (store) columns
    const FIXED_COLUMNS = new Set([
        'name', 'barcode', 'department', 'category', 'base unit', 'unit price',
        'default store', 'defaultstore', 'vendor', 'supplier', 'description', 'image url', 'imageurl',
    ]);

    const allHeaders = rows.length > 0 ? Object.keys(rows[0]) : [];
    const storeHeaders = allHeaders.filter(h => !FIXED_COLUMNS.has(h.toLowerCase()));
    // ── Normalized location matching ─────────────────────────────────────────
    // Handles: exact match, case differences, H&B/H&K → F&B/HK normalization,
    // truncated names (Excel cuts long headers to ~12 chars), trailing dots
    const normalize = (s) => s
        .toLowerCase()
        .replace(/h&b\./gi, 'f&b.')   // H&B.Horizon → F&B.Horizon
        .replace(/h&b\s/gi, 'f&b ')   // H&B Store → F&B Store
        .replace(/h&k\./gi, 'hk.')    // H&K.Store → HK.Store
        .replace(/h&k\s/gi, 'hk ')    // H&K Store → HK Store
        .replace(/\.+$/, '')           // strip trailing dots
        .replace(/\s+/g, ' ')
        .trim();

    // Build a normalized lookup map: normalizedName → { id, originalName }
    const locNormMap = new Map();
    for (const loc of locations) {
        locNormMap.set(normalize(loc.name), { id: loc.id, departmentId: loc.departmentId, name: loc.name });
    }

    // Try to resolve a header → location, with fuzzy fallback
    const resolveLocation = (header) => {
        const normHeader = normalize(header);

        // 1) Exact normalized match
        if (locNormMap.has(normHeader)) return locNormMap.get(normHeader);

        // 2) Prefix match — DB name starts with the (possibly truncated) header
        for (const [normName, locInfo] of locNormMap.entries()) {
            if (normName.startsWith(normHeader) || normHeader.startsWith(normName)) {
                return locInfo;
            }
        }

        // 3) Contains match — useful for partial overlap
        for (const [normName, locInfo] of locNormMap.entries()) {
            const shorter = normHeader.length < normName.length ? normHeader : normName;
            const longer  = normHeader.length < normName.length ? normName  : normHeader;
            if (shorter.length >= 4 && longer.includes(shorter)) {
                return locInfo;
            }
        }

        return null;
    };

    const storeColumnNames = [];
    const unknownStoreColumns = [];

    for (const header of storeHeaders) {
        const locInfo = resolveLocation(header);
        if (locInfo) {
            storeColumnNames.push({ header, locationId: locInfo.id });
        } else {
            unknownStoreColumns.push(header);
        }
    }

    const preview = rows.map((row, idx) => {
        const errors = [];
        const rowNum = idx + 2;

        const name = String(row['Name'] || row['name'] || '').trim();
        const barcode = String(row['Barcode'] || row['barcode'] || '').trim();
        const unitPrice = parseFloat(row['Unit Price'] || row['unitPrice'] || row['unit_price'] || 0);
        const catName = String(row['Category'] || row['category'] || '').trim();
        const baseUnit = String(row['Base Unit'] || row['baseUnit'] || row['base_unit'] || '').trim();
        const deptName = String(row['Department'] || row['department'] || '').trim();
        const vendorName = String(row['Vendor'] || row['vendor'] || row['Supplier'] || row['supplier'] || '').trim();

        if (!name) errors.push('Name is required');
        if (isNaN(unitPrice) || unitPrice < 0) errors.push('Invalid unit price');

        const categoryId = catName ? catMap.get(catName.toLowerCase()) : undefined;
        if (catName && !categoryId) errors.push(`Category '${catName}' not found`);

        const supplierId = vendorName ? supplierMap.get(vendorName.toLowerCase()) : undefined;
        // Vendor is optional — unknown vendor names are stored as text but don't block import

        let baseUnitId = undefined;
        if (baseUnit) {
            baseUnitId = unitMap.get(baseUnit.toLowerCase());
            if (!baseUnitId) {
                const cleanedUnit = baseUnit.replace(/\s*\(.*\)\s*$/, '').trim();
                baseUnitId = unitMap.get(cleanedUnit.toLowerCase());
            }
            if (!baseUnitId) errors.push(`Unit '${baseUnit}' not found`);
        }

        const departmentId = deptName ? deptMap.get(deptName.toLowerCase()) : undefined;
        if (deptName && !departmentId) errors.push(`Department '${deptName}' not found`);
        if (!deptName) errors.push('Department is required');

        // Parse store quantities from dynamic columns
        const storeQuantities = {};
        let firstStoreWithQty = null;
        for (const { header, locationId } of storeColumnNames) {
            const qty = parseFloat(row[header] || 0);
            if (!isNaN(qty) && qty > 0) {
                storeQuantities[locationId] = qty;
                if (!firstStoreWithQty) firstStoreWithQty = locationId;
            }
        }

        const defaultStoreId = firstStoreWithQty || null;

        return {
            rowNum,
            status: errors.length === 0 ? 'VALID' : 'ERROR',
            errors,
            data: {
                name,
                barcode: barcode || null,
                unitPrice: isNaN(unitPrice) ? 0 : unitPrice,
                departmentId: departmentId || null,
                defaultStoreId,
                categoryId: categoryId || null,
                supplierId: supplierId || null,
                baseUnitId: baseUnitId || null,
                deptName: deptName || null,
                vendorName: vendorName || null,
                storeQuantities,
            },
        };
    });

    const validCount = preview.filter(r => r.status === 'VALID').length;
    const invalidCount = preview.filter(r => r.status === 'ERROR').length;

    return {
        preview,
        total: rows.length,
        valid: validCount,
        invalid: invalidCount,
        storeColumns: storeColumnNames.map(s => s.header),
        unknownColumns: unknownStoreColumns,
    };
};

// ── EXCEL IMPORT: CONFIRM ─────────────────────────────────────────────────────
const confirmImport = async (rows, tenantId, createdBy, asOpeningBalance = false) => {
    const movementService = require('./movement.service');
    const postingService = require('./posting.service');

    let inserted = 0, updated = 0, failed = 0;
    const failures = [];
    const obDocuments = []; // Track created OB document IDs

    for (const row of rows) {
        if (row.status === 'ERROR') {
            failed++;
            failures.push({ rowNum: row.rowNum, errors: row.errors });
            continue;
        }

        const { name, barcode, unitPrice, departmentId, defaultStoreId, categoryId, supplierId, baseUnitId, storeQuantities } = row.data;

        try {
            // Check if item exists
            const existing = await prisma.item.findFirst({ where: { name, tenantId } });
            let itemId;

            if (existing) {
                await prisma.item.update({
                    where: { id: existing.id },
                    data: {
                        ...(barcode && { barcode }),
                        ...(unitPrice !== undefined && { unitPrice }),
                        ...(departmentId && { departmentId }),
                        ...(defaultStoreId && { defaultStoreId }),
                        ...(categoryId && { categoryId }),
                        ...(supplierId && { supplierId }),
                    },
                });
                itemId = existing.id;
                updated++;
            } else {
                const finalBarcode = barcode || Math.floor(100000000000 + Math.random() * 900000000000).toString();
                const created = await prisma.item.create({
                    data: {
                        name, unitPrice, categoryId,
                        barcode: finalBarcode,
                        tenantId,
                        ...(departmentId && { departmentId }),
                        ...(defaultStoreId && { defaultStoreId }),
                        ...(supplierId && { supplierId }),
                    },
                });
                itemId = created.id;

                // Add base unit if provided
                if (baseUnitId) {
                    await prisma.itemUnit.create({
                        data: {
                            itemId: created.id,
                            unitId: baseUnitId,
                            unitType: 'BASE',
                            conversionRate: 1,
                            isDefault: true,
                            tenantId,
                        },
                    });
                }
                inserted++;
            }

            // ── Create OB document if requested ───────────────────────────
            if (asOpeningBalance && storeQuantities && Object.keys(storeQuantities).length > 0) {

                // Zero-cost guard at import level
                if (!(Number(unitPrice) > 0)) {
                    throw new Error(`Opening Balance requires a valid unit cost. Item "${name}" has unitPrice = ${unitPrice || 0}. Please add a price before importing as Opening Balance.`);
                }

                const lines = Object.entries(storeQuantities).map(([locationId, qty]) => ({
                    itemId,
                    locationId,
                    qtyRequested: qty,
                    unitCost: unitPrice,
                    totalValue: qty * unitPrice,
                }));

                const obDoc = await movementService.createMovementDraft({
                    movementType: 'OPENING_BALANCE',
                    documentDate: new Date().toISOString(),
                    destLocationId: lines[0].locationId,
                    notes: `Opening Balance import for ${name}`,
                    lines,
                }, tenantId, createdBy);

                // Post immediately
                await postingService.postDocument(obDoc.id, tenantId, createdBy);
                obDocuments.push(obDoc.documentNo);
            }
        } catch (err) {
            failed++;
            failures.push({ rowNum: row.rowNum, errors: [err.message] });
        }
    }

    return {
        inserted, updated, failed, failures,
        ...(asOpeningBalance && { obDocuments, obCount: obDocuments.length }),
    };
};
// ── BULK UPLOAD IMAGES (ZIP) ──────────────────────────────────────────────────
const bulkUploadImages = async (zipFilePath, tenantId) => {
    const AdmZip = require('adm-zip');
    const fs = require('fs');
    const { UPLOADS_DIR } = require('../middleware/upload.middleware');

    const zip = new AdmZip(zipFilePath);
    const entries = zip.getEntries();

    const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const results = { matched: 0, skipped: 0, errors: [], details: [] };

    // Get all items for this tenant (barcode lookup)
    const items = await prisma.item.findMany({
        where: { tenantId },
        select: { id: true, barcode: true, name: true, imageUrl: true },
    });

    // Build barcode → item map
    const barcodeMap = new Map();
    for (const item of items) {
        if (item.barcode) {
            barcodeMap.set(item.barcode.toLowerCase(), item);
        }
    }

    for (const entry of entries) {
        // Skip directories and hidden files
        if (entry.isDirectory || entry.entryName.startsWith('__MACOSX') || entry.entryName.startsWith('.')) {
            continue;
        }

        const filename = path.basename(entry.entryName);
        const ext = path.extname(filename).toLowerCase();
        const nameWithoutExt = path.basename(filename, ext).trim();

        // Only process image files
        if (!IMAGE_EXTS.includes(ext)) {
            results.skipped++;
            results.details.push({ file: filename, status: 'skipped', reason: 'Not an image file' });
            continue;
        }

        // Match by barcode (filename without extension)
        const item = barcodeMap.get(nameWithoutExt.toLowerCase());

        if (!item) {
            results.skipped++;
            results.details.push({ file: filename, status: 'skipped', reason: `No item with barcode "${nameWithoutExt}"` });
            continue;
        }

        try {
            // Extract image to uploads folder
            const newFilename = `item-${item.id}-${Date.now()}${ext}`;
            const destPath = path.join(UPLOADS_DIR, newFilename);
            fs.writeFileSync(destPath, entry.getData());

            // Update item imageUrl — store as relative path, Vite proxy serves it in dev
            const imageUrl = toRelativeImageUrl(`/uploads/items/${newFilename}`);
            await prisma.item.update({
                where: { id: item.id },
                data: { imageUrl },
            });

            results.matched++;
            results.details.push({ file: filename, status: 'matched', itemName: item.name, barcode: item.barcode });
        } catch (err) {
            results.errors.push({ file: filename, error: err.message });
            results.details.push({ file: filename, status: 'error', reason: err.message });
        }
    }

    // Cleanup ZIP file
    try { fs.unlinkSync(zipFilePath); } catch { /* ignore */ }

    return results;
};

module.exports = {
    createItem,
    getItems,
    getItemById,
    updateItem,
    updateItemImage,
    deleteItem,
    toggleActive,
    getItemUnits,
    updateItemUnits,
    parseImportFile,
    confirmImport,
    bulkUploadImages,
};
