const { PrismaClient } = require('@prisma/client');
const { validate: uuidValidate } = require('uuid');
const prisma = new PrismaClient();

const MAX_ITEM_PAGE = 1000;
const MAX_ITEM_SLIM = 5000;

const isSlimQuery = (value) => value === 'true' || value === true;

const parseItemPagination = (querySkip, queryTake, defaultTake = 20) => {
    let skip = parseInt(querySkip, 10);
    if (!Number.isFinite(skip) || skip < 0) skip = 0;
    let take = parseInt(queryTake, 10);
    if (!Number.isFinite(take) || take < 1) take = defaultTake;
    take = Math.min(take, MAX_ITEM_PAGE);
    return { skip, take };
};

const XLSX = require('xlsx');
const path = require('path');
const auditService = require('./audit.service');
const settingService = require('./setting.service');
const { checkPeriodLock, checkOpeningBalanceAllowed } = require('./periodGuard.service');

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

/** Master catalog / Get Pass — no stock rows, smaller payload for large take */
const ITEM_CATALOG_INCLUDE = {
    department: { select: { id: true, name: true, code: true } },
    category: { select: { id: true, name: true } },
    subcategory: { select: { id: true, name: true } },
    supplier: { select: { id: true, name: true } },
    defaultStore: { select: { id: true, name: true, departmentId: true } },
    itemUnits: { include: { unit: { select: { id: true, name: true, abbreviation: true } } } },
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

const forbidden = (msg) => {
    const e = new Error(msg);
    e.statusCode = 403;
    return e;
};

const assertDepartmentInTenant = async (departmentId, tenantId) => {
    const dept = await prisma.department.findFirst({
        where: { id: departmentId, tenantId },
        select: { id: true },
    });
    if (!dept) throw notFound('Department not found');
};

const parseExcelNumber = (val) => {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return val;
    const normalized = String(val).replace(/,/g, '').trim();
    const parsed = parseFloat(normalized);
    return Number.isNaN(parsed) ? NaN : parsed;
};

/**
 * Prerequisite counts for Item Master (tenant-scoped).
 * canCreateItem is true when departments, units, categories, suppliers (vendors), and locations all exist (independent of OB phase).
 * isOpeningBalanceAllowed mirrors `settingService.isOpeningBalanceAllowed` (toggle / finalize state):
 * when true, OB setup is active and operational transactions stay blocked until finalize.
 */
const checkItemCreationRequirements = async (tenantId) => {
    const [departments, units, categories, vendors, locations] = await Promise.all([
        prisma.department.count({ where: { tenantId } }),
        prisma.unit.count({ where: { tenantId } }),
        prisma.category.count({ where: { tenantId } }),
        prisma.supplier.count({ where: { tenantId } }),
        prisma.location.count({ where: { tenantId } }),
    ]);

    const requirements = {
        departments: { count: departments },
        units: { count: units },
        categories: { count: categories },
        vendors: { count: vendors },
        locations: { count: locations },
    };

    const obCheck = await settingService.isOpeningBalanceAllowed(tenantId);
    const isOpeningBalanceAllowed = obCheck.allowed === true;

    const canCreateItem =
        departments > 0 &&
        units > 0 &&
        categories > 0 &&
        vendors > 0 &&
        locations > 0;

    if (!canCreateItem) {
        return {
            canCreateItem: false,
            requirements,
            blockReason: 'MISSING_PREREQUISITES',
            isOpeningBalanceAllowed,
        };
    }

    return { canCreateItem: true, requirements, isOpeningBalanceAllowed };
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
    const obCheck = await settingService.isOpeningBalanceAllowed(tenantId);
    if (!obCheck.allowed) {
        throw forbidden('Item creation is currently locked.');
    }

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
    const { search, categoryId, subcategoryId, departmentId, locationId, isActive, catalog, forGetPass, slim } = query;
    const slimMode = isSlimQuery(slim);
    const catalogMode =
        !slimMode &&
        (catalog === 'true' || catalog === true || forGetPass === 'true' || forGetPass === true);

    if (departmentId) {
        if (!uuidValidate(departmentId)) throw badRequest('Invalid departmentId');
        await assertDepartmentInTenant(departmentId, tenantId);
    }

    const hasExplicitIsActive = Object.prototype.hasOwnProperty.call(query, 'isActive');

    const where = {
        tenantId,
        ...(categoryId && { categoryId }),
        ...(subcategoryId && { subcategoryId }),
        ...(departmentId && { departmentId }),
        ...(locationId && { stockBalances: { some: { locationId } } }),
        ...(catalogMode && !hasExplicitIsActive ? { isActive: true } : {}),
        ...(hasExplicitIsActive ? { isActive: isActive === 'true' } : {}),
        ...(search && {
            OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { barcode: { contains: search, mode: 'insensitive' } },
                { department: { name: { contains: search, mode: 'insensitive' } } },
            ],
        }),
    };

    if (slimMode) {
        const items = await prisma.item.findMany({
            where,
            take: MAX_ITEM_SLIM,
            orderBy: { name: 'asc' },
            select: { id: true, name: true, barcode: true },
        });
        return { items, slim: true };
    }

    const { skip, take } = parseItemPagination(query.skip, query.take, 20);
    const include = catalogMode ? ITEM_CATALOG_INCLUDE : ITEM_INCLUDE;

    const [items, total] = await Promise.all([
        prisma.item.findMany({
            where,
            skip,
            take,
            orderBy: { name: 'asc' },
            include,
        }),
        prisma.item.count({ where }),
    ]);

    return { items, total, skip, take };
};

/**
 * Items receivable at a warehouse (GRN destination): in stock there, default store = location,
 * or item category is linked to this location via LocationCategory.
 * Each row includes `currentStock` (qty on hand at this location, 0 if no balance row).
 */
const getItemsByLocationId = async (tenantId, locationId, query = {}) => {
    if (!uuidValidate(locationId)) throw badRequest('Invalid locationId');

    const location = await prisma.location.findFirst({
        where: { id: locationId, tenantId },
        select: { id: true },
    });
    if (!location) {
        const e = new Error('Location not found');
        e.statusCode = 404;
        throw e;
    }

    const { search } = query;
    const term = search && String(search).trim() ? String(search).trim() : '';

    const locationOr = [
        { stockBalances: { some: { locationId } } },
        { defaultStoreId: locationId },
        { category: { locationCategories: { some: { locationId } } } },
    ];

    const where = {
        tenantId,
        isActive: true,
        AND: [
            { OR: locationOr },
            ...(term
                ? [{
                    OR: [
                        { name: { contains: term, mode: 'insensitive' } },
                        { barcode: { contains: term, mode: 'insensitive' } },
                        { code: { contains: term, mode: 'insensitive' } },
                    ],
                }]
                : []),
        ],
    };

    let take = parseInt(query.take, 10);
    if (!Number.isFinite(take) || take < 1) take = 500;
    take = Math.min(take, 1000);

    const items = await prisma.item.findMany({
        where,
        orderBy: { name: 'asc' },
        take,
        include: {
            ...ITEM_CATALOG_INCLUDE,
            stockBalances: {
                where: { locationId },
                select: { qtyOnHand: true },
            },
        },
    });

    return items.map((it) => {
        const sb = it.stockBalances?.[0];
        const currentStock = sb && sb.qtyOnHand != null ? Number(sb.qtyOnHand) : 0;
        const { stockBalances, ...rest } = it;
        return { ...rest, currentStock };
    });
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
const parseImportFile = async (filePath, tenantId, options = {}) => {
    const asOpeningBalance = Boolean(options.asOpeningBalance);
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (rows.length === 0) throw badRequest('The uploaded file has no data rows.');
    if (rows.length > 1000) throw badRequest('Maximum 1000 rows per import.');

    // Fetch lookup data once
    const [categories, units, departments, locations, suppliers] = await Promise.all([
        prisma.category.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true } }),
        prisma.unit.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true, abbreviation: true } }),
        prisma.department.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true } }),
        prisma.location.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true, departmentId: true } }),
        prisma.supplier.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true } }),
    ]);

    const catMap = new Map(categories.map(c => [c.name.toLowerCase(), c.id]));
    const unitNameMap = new Map(units.map(u => [u.name.toLowerCase(), u.id]));
    const unitAbbreviationMap = new Map(
        units
            .filter(u => u.abbreviation)
            .map(u => [String(u.abbreviation).toLowerCase(), u.id])
    );
    const deptMap = new Map(departments.map(d => [d.name.toLowerCase(), d.id]));
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
    if (unknownStoreColumns.length > 0) {
        throw badRequest(
            `Unknown store column(s): ${unknownStoreColumns.join(', ')}. `
            + 'Please use valid store names from the template.'
        );
    }

    // Preload existing DB items for fast "exists in DB" checks
    const incomingNames = [...new Set(
        rows
            .map(row => String(row['Name'] || row['name'] || '').trim().toLowerCase())
            .filter(Boolean)
    )];
    const existingItems = incomingNames.length > 0
        ? await prisma.item.findMany({
            where: { tenantId },
            select: { id: true, name: true },
        })
        : [];
    const existingByNameMap = new Map(
        existingItems
            .filter(item => item.name)
            .map(item => [String(item.name).toLowerCase(), item])
    );

    // In-file duplicate detection
    const seenNames = new Set();

    const preview = rows.map((row, idx) => {
        const issues = [];
        const rowNum = idx + 2;
        const addIssue = (field, message, severity, code) => {
            issues.push({ field, message, severity, code });
        };

        const name = String(row['Name'] || row['name'] || '').trim();
        const unitPrice = parseExcelNumber(row['Unit Price'] || row['unitPrice'] || row['unit_price'] || 0);
        const catName = String(row['Category'] || row['category'] || '').trim();
        const baseUnit = String(row['Base Unit'] || row['baseUnit'] || row['base_unit'] || '').trim();
        const deptName = String(row['Department'] || row['department'] || '').trim();
        const vendorName = String(row['Vendor'] || row['vendor'] || row['Supplier'] || row['supplier'] || '').trim();

        if (!name) addIssue('name', 'Name is required', 'error', 'REQUIRED');
        if (isNaN(unitPrice) || unitPrice < 0) addIssue('unitPrice', 'Invalid unit price', 'error', 'INVALID_NUMBER');

        const normalizedName = name.toLowerCase();
        if (name) {
            if (seenNames.has(normalizedName)) {
                addIssue('name', `Name '${name}' is duplicated in file`, 'error', 'DUPLICATE_IN_FILE');
            } else {
                seenNames.add(normalizedName);
            }
        }

        const categoryId = catName ? catMap.get(catName.toLowerCase()) : undefined;
        if (catName && !categoryId) addIssue('category', `Category '${catName}' not found`, 'error', 'NOT_FOUND');

        const supplierId = vendorName ? supplierMap.get(vendorName.toLowerCase()) : undefined;
        if (vendorName && !supplierId) addIssue('vendor', `Vendor '${vendorName}' not found`, 'error', 'NOT_FOUND');

        let baseUnitId = undefined;
        if (baseUnit) {
            const unitCodeMatch = baseUnit.match(/\(([^)]+)\)/);
            if (unitCodeMatch?.[1]) {
                const unitCode = unitCodeMatch[1].trim().toLowerCase();
                baseUnitId = unitAbbreviationMap.get(unitCode);
            }
            if (!baseUnitId) {
                const cleanedUnit = baseUnit.replace(/\s*\(.*\)\s*$/, '').trim();
                baseUnitId = unitNameMap.get(cleanedUnit.toLowerCase());
            }
            if (!baseUnitId) addIssue('baseUnit', `Unit '${baseUnit}' not found`, 'error', 'NOT_FOUND');
        }

        const departmentId = deptName ? deptMap.get(deptName.toLowerCase()) : undefined;
        if (deptName && !departmentId) addIssue('department', `Department '${deptName}' not found`, 'error', 'NOT_FOUND');
        if (!deptName) addIssue('department', 'Department is required', 'error', 'REQUIRED');

        // DB existence / update intent (match by name only; barcodes are system-generated)
        const existingByName = name ? existingByNameMap.get(normalizedName) : null;
        const matchedExisting = existingByName || null;
        const isUpdate = Boolean(matchedExisting);
        if (isUpdate) {
            addIssue(
                'name',
                `Row matches existing item in DB (${matchedExisting.name}). Import will update it.`,
                'warning',
                'EXISTS_IN_DB'
            );
        }

        // Parse store quantities from dynamic columns
        const storeQuantities = {};
        let firstStoreWithQty = null;
        for (const { header, locationId } of storeColumnNames) {
            const rawQty = row[header];
            const qty = parseExcelNumber(rawQty || 0);
            const hasRawValue = rawQty !== null && rawQty !== undefined && String(rawQty).trim() !== '';
            if (hasRawValue && Number.isNaN(qty)) {
                addIssue(`store__${header}`, `Invalid quantity in store column '${header}'`, 'error', 'INVALID_NUMBER');
                continue;
            }
            if (!isNaN(qty) && qty > 0) {
                storeQuantities[locationId] = qty;
                if (!firstStoreWithQty) firstStoreWithQty = locationId;
            }
        }

        const defaultStoreId = firstStoreWithQty || null;
        const errors = issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message);

        return {
            rowNum,
            status: errors.length === 0 ? 'VALID' : 'ERROR',
            isUpdate,
            issues,
            errors,
            data: {
                name,
                unitPrice: isNaN(unitPrice) ? 0 : unitPrice,
                departmentId: departmentId || null,
                defaultStoreId,
                categoryId: categoryId || null,
                supplierId: supplierId || null,
                baseUnitId: baseUnitId || null,
                categoryName: catName || null,
                baseUnitName: baseUnit || null,
                deptName: deptName || null,
                vendorName: vendorName || null,
                storeQuantities,
                isUpdate,
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
        contractVersion: 'V2',
        summary: {
            asOpeningBalance,
            openingBalanceReason: {
                required: asOpeningBalance,
                message: asOpeningBalance ? 'Global reason is required for Opening Balance confirm step.' : null,
            },
        },
    };
};

/**
 * Opening Balance Excel import: idempotent per (itemId + locationId).
 * - If OPENING_BALANCE ledger row(s) already exist for that pair: set StockBalance.qtyOnHand
 *   to the Excel value (not increment), keep one ledger row in sync (qtyIn, value, balanceAfter),
 *   remove duplicate OB ledger rows, and update MovementLine when referenceId exists.
 * - Otherwise: create a single-line OB draft and post (existing engine path).
 * Caller must run inside prisma.$transaction and pass tx.
 */
const upsertOpeningBalanceForItemLocation = async (
    tx,
    {
        tenantId,
        itemId,
        locationId,
        targetQty,
        unitCost,
        userId,
        itemName,
    },
    movementService,
    postingService
) => {
    const qty = Number(targetQty);
    if (!(qty > 0) || !(Number(unitCost) > 0)) {
        throw new Error(`Invalid Opening Balance qty/cost for "${itemName}" at location.`);
    }

    const txDate = new Date();
    const totalValue = qty * Number(unitCost);

    const existingObRows = await tx.inventoryLedger.findMany({
        where: {
            tenantId,
            itemId,
            locationId,
            movementType: 'OPENING_BALANCE',
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    if (existingObRows.length > 0) {
        // Correction path: do not require OB window (may be LOCKED after other postings).
        await checkPeriodLock(tenantId, txDate);

        const primary = existingObRows[0];
        const duplicateIds = existingObRows.slice(1).map((r) => r.id);
        if (duplicateIds.length > 0) {
            await tx.inventoryLedger.deleteMany({ where: { id: { in: duplicateIds } } });
        }

        await tx.inventoryLedger.update({
            where: { id: primary.id },
            data: {
                qtyIn: qty,
                qtyOut: 0,
                unitCost,
                totalValue: totalValue,
                balanceAfter: qty,
            },
        });

        await tx.stockBalance.upsert({
            where: { tenantId_itemId_locationId: { tenantId, itemId, locationId } },
            update: {
                qtyOnHand: qty,
                wacUnitCost: unitCost,
            },
            create: {
                tenantId,
                itemId,
                locationId,
                qtyOnHand: qty,
                wacUnitCost: unitCost,
            },
        });

        if (primary.referenceId) {
            await tx.movementLine.updateMany({
                where: { documentId: primary.referenceId, itemId, locationId },
                data: {
                    qtyRequested: qty,
                    qtyInBaseUnit: qty,
                    unitCost,
                    totalValue: totalValue,
                },
            });
        }

        return { kind: 'updated' };
    }

    await checkOpeningBalanceAllowed(tenantId, txDate);

    const obDoc = await movementService.createMovementDraft(
        {
            movementType: 'OPENING_BALANCE',
            documentDate: txDate.toISOString(),
            destLocationId: locationId,
            notes: `Opening Balance import for ${itemName}`,
            lines: [
                {
                    itemId,
                    locationId,
                    qtyRequested: qty,
                    unitCost,
                    totalValue: totalValue,
                },
            ],
        },
        tenantId,
        userId,
        tx
    );

    const posted = await postingService.postDocument(obDoc.id, tenantId, userId, tx);
    return { kind: 'posted', documentNo: posted.documentNo || obDoc.documentNo };
};

// ── EXCEL IMPORT: CONFIRM ─────────────────────────────────────────────────────
const confirmImport = async (rows, tenantId, createdBy, asOpeningBalance = false) => {
    const movementService = require('./movement.service');
    const postingService = require('./posting.service');

    let inserted = 0, updated = 0, failed = 0;
    const failures = [];
    const obDocuments = []; // Newly posted OB document numbers (one per new item+location)
    let obLocationUpdates = 0;

    for (const row of rows) {
        if (row.status === 'ERROR') {
            failed++;
            failures.push({ rowNum: row.rowNum, errors: row.errors });
            continue;
        }

        const { name, unitPrice, departmentId, defaultStoreId, categoryId, supplierId, baseUnitId, storeQuantities } = row.data;

        try {
            const txResult = await prisma.$transaction(async (tx) => {
                // Check if item exists
                const existing = await tx.item.findFirst({ where: { name, tenantId } });
                let itemId;
                let wasInserted = false;
                let wasUpdated = false;
                const obDocNosThisRow = [];
                let obLocationsUpdatedThisRow = 0;

                if (existing) {
                    await tx.item.update({
                        where: { id: existing.id },
                        data: {
                            ...(unitPrice !== undefined && { unitPrice }),
                            ...(departmentId && { departmentId }),
                            ...(defaultStoreId && { defaultStoreId }),
                            ...(categoryId && { categoryId }),
                            ...(supplierId && { supplierId }),
                        },
                    });
                    itemId = existing.id;
                    wasUpdated = true;
                } else {
                    const finalBarcode = Math.floor(100000000000 + Math.random() * 900000000000).toString();
                    const created = await tx.item.create({
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
                    wasInserted = true;

                    // Add base unit if provided
                    if (baseUnitId) {
                        await tx.itemUnit.create({
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
                }

                // ── Opening Balance: idempotent per (itemId + locationId) ──
                if (asOpeningBalance && storeQuantities && Object.keys(storeQuantities).length > 0) {
                    if (!(Number(unitPrice) > 0)) {
                        throw new Error(`Opening Balance requires a valid unit cost. Item "${name}" has unitPrice = ${unitPrice || 0}. Please add a price before importing as Opening Balance.`);
                    }

                    for (const [locationId, qty] of Object.entries(storeQuantities)) {
                        const result = await upsertOpeningBalanceForItemLocation(
                            tx,
                            {
                                tenantId,
                                itemId,
                                locationId,
                                targetQty: qty,
                                unitCost: unitPrice,
                                userId: createdBy,
                                itemName: name,
                            },
                            movementService,
                            postingService
                        );
                        if (result.kind === 'posted' && result.documentNo) {
                            obDocNosThisRow.push(result.documentNo);
                        }
                        if (result.kind === 'updated') {
                            obLocationsUpdatedThisRow += 1;
                        }
                    }
                }

                return { wasInserted, wasUpdated, obDocNosThisRow, obLocationsUpdatedThisRow };
            });

            if (txResult.wasInserted) inserted++;
            if (txResult.wasUpdated) updated++;
            for (const no of txResult.obDocNosThisRow || []) {
                obDocuments.push(no);
            }
            obLocationUpdates += txResult.obLocationsUpdatedThisRow || 0;
        } catch (err) {
            failed++;
            failures.push({ rowNum: row.rowNum, errors: [err.message] });
        }
    }

    return {
        inserted, updated, failed, failures,
        ...(asOpeningBalance && {
            obDocuments,
            obCount: obDocuments.length,
            obLocationUpdates,
        }),
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
    checkItemCreationRequirements,
    createItem,
    getItems,
    getItemsByLocationId,
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
